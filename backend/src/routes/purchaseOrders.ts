import { Hono } from "hono";
import type { Env } from "../types";
import type { AdminVars } from "../auth/adminSession";
import { requireAdminSession } from "../auth/adminSession";
import { getShopById } from "../db/shops";
import { getVariantIdForMaterialCode, listMaterialCodeMaps, deleteMaterialCodeMap } from "../db/materialCodeMap";
import { parseFonterraDeliveryNote, type ParsedLine } from "../purchaseOrders/parseFonterra";
import { pickBestMatch } from "../purchaseOrders/matching";
import { findVariantBySku, searchVariantCandidates, searchVariantsByQuery } from "../shopify/products";
import { listActiveLocations, getVariantState } from "../shopify/inventory";
import { fetchStockRows, type StockRow } from "../shopify/stockList";
import { upsertMaterialCodeMap } from "../db/materialCodeMap";
import { adjustInventory } from "../shopify/inventory";
import { createStockEvent, type NewEventLine, listStockEvents, getStockEventForShop, listStockEventLines } from "../db/stockEvents";
import { addTrackedProduct } from "../db/trackedProducts";
import { putPhoto, getPhoto } from "../r2";
import { newId } from "../ids";
import type { BbdState } from "../bbd";

export const purchaseOrderRoutes = new Hono<{ Bindings: Env; Variables: AdminVars }>();

const MAX_PDF_BYTES = 10 * 1024 * 1024;

export interface ParseResponseLine {
  materialCode: string;
  description: string;
  deliveredQty: number;
  sled: string;
  match: {
    variantId: string;
    inventoryItemId: string;
    productTitle: string;
    productId: string;
    imageUrl: string | null;
    /** The page a customer sees. Null when the product is not published online. */
    onlineStoreUrl: string | null;
    sku: string | null;
    matchSource: "sku" | "mapping" | "fuzzy";
    currentBbd: BbdState;
    stockByLocation: { locationId: string; available: number }[];
  } | null;
}

export interface ParseResponse {
  shopDomain: string;
  locations: { id: string; name: string }[];
  lines: ParseResponseLine[];
}

interface MaterialCodeLookup {
  getVariantIdForMaterialCode: (materialCode: string) => Promise<string | null>;
}

async function matchLine(
  shop: { shop_domain: string; access_token: string },
  line: ParsedLine,
  lookup: MaterialCodeLookup
): Promise<ParseResponseLine["match"]> {
  const bySku = await findVariantBySku(shop.shop_domain, shop.access_token, line.materialCode);
  let matched: { id: string; sku: string | null; title: string; matchSource: "sku" | "mapping" | "fuzzy" } | null =
    bySku ? { ...bySku, matchSource: "sku" } : null;

  if (!matched) {
    const mappedId = await lookup.getVariantIdForMaterialCode(line.materialCode);
    if (mappedId) matched = { id: mappedId, sku: null, title: line.description, matchSource: "mapping" };
  }

  if (!matched) {
    const candidates = await searchVariantCandidates(shop.shop_domain, shop.access_token, line.description);
    const best = pickBestMatch(line.description, candidates);
    if (best) matched = { id: best.id, sku: best.sku, title: best.title, matchSource: "fuzzy" };
  }

  if (!matched) return null;

  const state = await getVariantState(shop.shop_domain, shop.access_token, matched.id);
  if (!state) return null; // stale match — variant was deleted since

  return {
    variantId: matched.id,
    inventoryItemId: state.inventoryItemId,
    productTitle: state.productTitle || matched.title,
    productId: state.productId,
    imageUrl: state.imageUrl,
    onlineStoreUrl: state.onlineStoreUrl,
    sku: matched.sku,
    matchSource: matched.matchSource,
    currentBbd: state.currentBbd,
    stockByLocation: state.stockByLocation,
  };
}

export async function orchestrateParse(
  _db: D1Database,
  shop: { shop_domain: string; access_token: string },
  lines: ParsedLine[],
  lookup: MaterialCodeLookup
): Promise<ParseResponse> {
  const locations = await listActiveLocations(shop.shop_domain, shop.access_token);
  const resultLines: ParseResponseLine[] = [];
  for (const line of lines) {
    const match = await matchLine(shop, line, lookup);
    resultLines.push({
      materialCode: line.materialCode,
      description: line.description,
      deliveredQty: line.deliveredQty,
      sled: line.sled,
      match,
    });
  }
  return { shopDomain: shop.shop_domain, locations, lines: resultLines };
}

purchaseOrderRoutes.post("/admin/api/purchase-orders/parse", requireAdminSession(), async (c) => {
  const shop = await getShopById(c.env.DB, c.get("shopId"));
  if (!shop) return c.json({ error: "shop not found" }, 404);

  const fd = await c.req.formData();
  const pdf: unknown = fd.get("pdf");
  if (!(pdf instanceof File)) return c.json({ error: "pdf file required" }, 400);
  if ((pdf.type || "") !== "application/pdf") return c.json({ error: "file must be a PDF" }, 400);
  if (pdf.size > MAX_PDF_BYTES) return c.json({ error: "PDF too large" }, 413);

  let lines;
  try {
    lines = await parseFonterraDeliveryNote(new Uint8Array(await pdf.arrayBuffer()));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "failed to parse PDF" }, 422);
  }

  const result = await orchestrateParse(c.env.DB, shop, lines, {
    getVariantIdForMaterialCode: (code) => getVariantIdForMaterialCode(c.env.DB, c.get("shopId"), code),
  });
  return c.json(result);
});

purchaseOrderRoutes.get("/admin/api/products/search", requireAdminSession(), async (c) => {
  const shop = await getShopById(c.env.DB, c.get("shopId"));
  if (!shop) return c.json({ error: "shop not found" }, 404);
  const q = c.req.query("q")?.trim();
  if (!q) return c.json({ variants: [] });
  const found = await searchVariantsByQuery(shop.shop_domain, shop.access_token, q);
  const variants = found.slice(0, 8);

  // The Stock tab's picker asks for stock and BBD (?stock=1). Deciding whether
  // to track a product means knowing what you already hold and how fresh it is
  // — without them the list is eight near-identical names. One extra Shopify
  // request for the whole page of results, and only when asked, so the import
  // pickers (which show current → resulting stock on their own review screen)
  // don't pay for it.
  if (c.req.query("stock") === "1" && variants.length > 0) {
    const locationId = c.req.query("locationId") ?? null;
    try {
      const rows = await fetchStockRows(
        shop.shop_domain,
        shop.access_token,
        variants.map((v) => v.id)
      );
      return c.json({
        variants: variants.map((v) => {
          const row = rows.get(v.id);
          if (!row) return v;
          const at = locationId
            ? row.stockByLocation.find((s) => s.locationId === locationId)
            : row.stockByLocation[0];
          return { ...v, available: at ? at.available : null, bbd: row.bbd };
        }),
      });
    } catch (err) {
      // The names and SKUs are the point; stock is the annotation. A failure
      // here must not take the search down with it — but it should be visible
      // to whoever wonders why the picker stopped showing stock.
      console.error("search stock annotation failed", { err: String(err) });
      return c.json({ variants });
    }
  }

  return c.json({ variants });
});

interface ConfirmLine {
  materialCode: string;
  description: string;
  /** What the merchant saw the line matched to, for the history record. */
  productTitle?: string | null;
  deliveredQty: number;
  sled: string;
  variantId: string | null;
  matchSource: "sku" | "mapping" | "fuzzy" | "manual" | null;
  skip: boolean;
}

async function processConfirmLine(
  shop: { shop_domain: string; access_token: string },
  db: D1Database,
  shopId: string,
  locationId: string,
  line: ConfirmLine,
  /** Pre-read by the caller in one batched request — see the confirm handler. */
  state: StockRow | undefined
): Promise<{ line: NewEventLine; resultStatus: "ok" | "error" | "skipped"; error?: string }> {
  const id = newId("poline");

  if (line.skip || !line.variantId) {
    return {
      line: {
        id, materialCode: line.materialCode, description: line.description,
        productTitle: line.productTitle ?? null, shopifyVariantId: line.variantId,
        deliveredQty: line.deliveredQty, qtyBefore: null, qtyAfter: null, sled: line.sled,
        skipped: true, status: "skipped", error: null,
      },
      resultStatus: "skipped",
    };
  }

  let before: number | null = null;
  let adjusted = false;
  // BBD is never written automatically. The merchant reviews Best Before Dates
  // monthly by hand, so auto-writing would gain a few weeks of freshness while
  // being the only place StockProof edits the public storefront without the
  // merchant confirming that specific change. The delivery note's date is shown
  // on the review screen as a prompt for the next monthly pass instead.

  try {
    // Absent from the batch read = deleted in Shopify since the note was parsed.
    if (!state) throw new Error("product no longer exists in Shopify");

    before = state.stockByLocation.find((s) => s.locationId === locationId)?.available ?? 0;
    await adjustInventory(shop.shop_domain, shop.access_token, state.inventoryItemId, locationId, line.deliveredQty);
    adjusted = true;

    if (line.matchSource && line.matchSource !== "sku") {
      await upsertMaterialCodeMap(db, {
        id: newId("map"), shopId, materialCode: line.materialCode,
        shopifyVariantId: line.variantId, updatedAt: Math.floor(Date.now() / 1000),
      });
    }

    await addTrackedProduct(db, {
      id: newId("tp"),
      shopId,
      shopifyVariantId: line.variantId,
      shopifyProductId: state.productId,
      addedAt: Math.floor(Date.now() / 1000),
    });

    return {
      line: {
        id, materialCode: line.materialCode, description: line.description,
        productTitle: state.title || line.productTitle || null, shopifyVariantId: line.variantId,
        deliveredQty: line.deliveredQty, qtyBefore: before, qtyAfter: before + line.deliveredQty, sled: line.sled,
        skipped: false, status: "ok", error: null,
      },
      resultStatus: "ok",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    if (adjusted) {
      const qtyBefore = before ?? 0;
      return {
        line: {
          id, materialCode: line.materialCode, description: line.description,
          productTitle: line.productTitle ?? null, shopifyVariantId: line.variantId,
          deliveredQty: line.deliveredQty, qtyBefore, qtyAfter: qtyBefore + line.deliveredQty, sled: line.sled,
          skipped: false, status: "error",
          error: `stock updated but a follow-up step failed: ${message}`,
        },
        resultStatus: "error",
        error: `stock updated but a follow-up step failed: ${message}`,
      };
    }
    return {
      line: {
        id, materialCode: line.materialCode, description: line.description,
        productTitle: line.productTitle ?? null, shopifyVariantId: line.variantId,
        deliveredQty: line.deliveredQty, qtyBefore: null, qtyAfter: null, sled: line.sled,
        skipped: false, status: "error", error: message,
      },
      resultStatus: "error",
      error: message,
    };
  }
}

purchaseOrderRoutes.post("/admin/api/purchase-orders/confirm", requireAdminSession(), async (c) => {
  const shopId = c.get("shopId");
  const shop = await getShopById(c.env.DB, shopId);
  if (!shop) return c.json({ error: "shop not found" }, 404);

  const fd = await c.req.formData();
  const pdf: unknown = fd.get("pdf");
  if (!(pdf instanceof File)) return c.json({ error: "pdf file required" }, 400);
  if ((pdf.type || "") !== "application/pdf") return c.json({ error: "file must be a PDF" }, 400);
  if (pdf.size > MAX_PDF_BYTES) return c.json({ error: "PDF too large" }, 413);

  const locationId = String(fd.get("locationId") ?? "");
  if (!locationId) return c.json({ error: "locationId required" }, 400);

  let lines: ConfirmLine[];
  try {
    lines = JSON.parse(String(fd.get("lines") ?? "[]"));
  } catch {
    return c.json({ error: "lines must be valid JSON" }, 400);
  }
  if (!Array.isArray(lines) || lines.length === 0) return c.json({ error: "at least one line required" }, 400);

  // One batched read for the whole delivery, before anything is written.
  //
  // Reading per line cost 2 Shopify subrequests per line — a 25-line note hit
  // Cloudflare's 50-subrequest cap and failed MID-BATCH, after earlier lines
  // had already added stock. Fonterra notes routinely run past 25 lines. This
  // is N+1 instead of 2N, and the same fix /save already carries.
  const readIds = [...new Set(lines.filter((l) => !l.skip && l.variantId).map((l) => l.variantId as string))];
  let live = new Map<string, StockRow>();
  try {
    live = await fetchStockRows(shop.shop_domain, shop.access_token, readIds);
  } catch (err) {
    // No write has happened yet. Fail every line identically rather than
    // adding stock for some of them and reporting a 500 for the rest.
    console.error("confirm batch read failed", { shopId, lines: readIds.length, err: String(err) });
    return c.json({ error: "Couldn't read current stock from Shopify — nothing was written. Try again." }, 502);
  }

  const results: Awaited<ReturnType<typeof processConfirmLine>>[] = [];
  for (const line of lines) {
    results.push(await processConfirmLine(shop, c.env.DB, shopId, locationId, line, live.get(line.variantId ?? "")));
  }

  const importId = newId("po");
  const pdfR2Key = `po/${shopId}/${importId}.pdf`;
  await putPhoto(c.env.PHOTOS, pdfR2Key, await pdf.arrayBuffer(), "application/pdf");

  await createStockEvent(c.env.DB, {
    id: importId, shopId, kind: "import", filename: pdf.name || "delivery.pdf", pdfR2Key, locationId,
    createdAt: Math.floor(Date.now() / 1000), lines: results.map((r) => r.line),
  });

  return c.json({
    importId,
    lines: results.map((r, i) => ({ materialCode: lines[i].materialCode, status: r.resultStatus, ...(r.error ? { error: r.error } : {}) })),
  });
});

purchaseOrderRoutes.get("/admin/api/purchase-orders", requireAdminSession(), async (c) => {
  const limit = Number(c.req.query("limit")) || undefined;
  const offset = Number(c.req.query("offset")) || undefined;
  const events = await listStockEvents(c.env.DB, c.get("shopId"), { limit, offset });
  // `imports` kept as an alias so a stale cached page keeps working through a
  // deploy; both names carry the same list, which now includes counts.
  return c.json({ events, imports: events });
});

purchaseOrderRoutes.get("/admin/api/purchase-orders/:id", requireAdminSession(), async (c) => {
  const record = await getStockEventForShop(c.env.DB, c.get("shopId"), c.req.param("id"));
  if (!record) return c.json({ error: "not found" }, 404);
  const lines = await listStockEventLines(c.env.DB, record.id);
  return c.json({ event: record, import: record, lines });
});

purchaseOrderRoutes.get("/admin/api/purchase-orders/:id/pdf", requireAdminSession(), async (c) => {
  const record = await getStockEventForShop(c.env.DB, c.get("shopId"), c.req.param("id"));
  // A count has no PDF; only an import does.
  if (!record || !record.pdf_r2_key) return c.json({ error: "not found" }, 404);
  const obj = await getPhoto(c.env.PHOTOS, record.pdf_r2_key);
  if (!obj) return c.json({ error: "not found" }, 404);
  return new Response(obj.body, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${(record.filename ?? "delivery.pdf").replace(/[\r\n"]/g, "")}"`,
    },
  });
});

// --- Remembered material codes -------------------------------------------
//
// A mapping is created implicitly whenever a merchant picks a product by hand
// during an import, and from then on it is applied ahead of every fuzzy match,
// silently. That is the point — but it also means one wrong pick keeps being
// wrong on every future import, presented as a confident match. Until now
// there was no way to see the table, let alone correct it.

purchaseOrderRoutes.get("/admin/api/material-codes", requireAdminSession(), async (c) => {
  const shopId = c.get("shopId");
  const shop = await getShopById(c.env.DB, shopId);
  if (!shop) return c.json({ error: "shop not found" }, 404);

  const rows = await listMaterialCodeMaps(c.env.DB, shopId);
  // Resolved against Shopify so the merchant sees the product, not a gid. A
  // list of opaque ids cannot be audited, which would leave the wrong mapping
  // just as invisible as before.
  const live = await fetchStockRows(shop.shop_domain, shop.access_token, rows.map((r) => r.shopifyVariantId));

  return c.json({
    mappings: rows.map((r) => {
      const v = live.get(r.shopifyVariantId);
      return {
        materialCode: r.materialCode,
        variantId: r.shopifyVariantId,
        updatedAt: r.updatedAt,
        title: v?.title ?? null,
        sku: v?.sku ?? null,
        imageUrl: v?.imageUrl ?? null,
        // The product this code points at has been deleted in Shopify: the
        // mapping will match on the next import and then fail on the write.
        missing: !v,
      };
    }),
  });
});

purchaseOrderRoutes.post("/admin/api/material-codes", requireAdminSession(), async (c) => {
  const shopId = c.get("shopId");
  const shop = await getShopById(c.env.DB, shopId);
  if (!shop) return c.json({ error: "shop not found" }, 404);

  type Body = { materialCode?: string; variantId?: string };
  const body = await c.req.json<Body>().catch(() => ({}) as Body);
  const materialCode = body.materialCode?.trim();
  if (!materialCode || !body.variantId) return c.json({ error: "materialCode and variantId required" }, 400);

  // Verified against Shopify rather than taken on trust: a mapping to a
  // non-existent variant would look correct in the list and fail at the write.
  const live = await fetchStockRows(shop.shop_domain, shop.access_token, [body.variantId]);
  if (!live.get(body.variantId)) return c.json({ error: "no such product in this shop" }, 404);

  await upsertMaterialCodeMap(c.env.DB, {
    id: newId("map"), shopId, materialCode,
    shopifyVariantId: body.variantId, updatedAt: Math.floor(Date.now() / 1000),
  });
  return c.json({ ok: true });
});

purchaseOrderRoutes.delete("/admin/api/material-codes/:code", requireAdminSession(), async (c) => {
  await deleteMaterialCodeMap(c.env.DB, c.get("shopId"), c.req.param("code"));
  return c.json({ ok: true });
});
