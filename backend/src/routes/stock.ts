import { Hono } from "hono";
import type { Env } from "../types";
import type { AdminVars } from "../auth/adminSession";
import { requireAdminSession } from "../auth/adminSession";
import { getShopById } from "../db/shops";
import {
  listTrackedProducts, addTrackedProduct, removeTrackedProduct, markCounted,
} from "../db/trackedProducts";
import { fetchStockRows, setInventoryQuantity, type StockRow } from "../shopify/stockList";
import { listActiveLocations } from "../shopify/inventory";
import { newId } from "../ids";

export const stockRoutes = new Hono<{ Bindings: Env; Variables: AdminVars }>();

stockRoutes.get("/admin/api/stock", requireAdminSession(), async (c) => {
  const shopId = c.get("shopId");
  const shop = await getShopById(c.env.DB, shopId);
  if (!shop) return c.json({ error: "shop not found" }, 404);

  const locations = await listActiveLocations(shop.shop_domain, shop.access_token);
  const tracked = await listTrackedProducts(c.env.DB, shopId);
  const live = await fetchStockRows(shop.shop_domain, shop.access_token, tracked.map((t) => t.shopifyVariantId));

  const rows = tracked.map((t) => {
    const row = live.get(t.shopifyVariantId);
    // Absent from the live read = deleted in Shopify since it was tracked.
    // Surface it so the merchant can remove it, rather than hiding the row and
    // leaving them wondering where the product went.
    if (!row) return { variantId: t.shopifyVariantId, missing: true as const };
    return { ...row, lastCountedAt: t.lastCountedAt, missing: false as const };
  });

  // Stock and BBD are never cached anywhere in this feature — D1 stores only
  // which variants are tracked and when they were last counted. /admin itself
  // is already no-store; the endpoint carrying the actual numbers must be too,
  // or an intermediary can hand the merchant a figure Shopify no longer holds.
  return c.json({ locations, rows }, 200, { "cache-control": "no-store" });
});

stockRoutes.post("/admin/api/stock/items", requireAdminSession(), async (c) => {
  const shopId = c.get("shopId");
  const shop = await getShopById(c.env.DB, shopId);
  if (!shop) return c.json({ error: "shop not found" }, 404);

  const body = await c.req
    .json<{ variantId?: string }>()
    .catch(() => ({}) as { variantId?: string });
  if (!body.variantId) return c.json({ error: "variantId required" }, 400);

  // The product id comes from Shopify, not from the caller. It used to be
  // taken on trust from the request body, which was harmless only because
  // nothing read it back: the list renders the product from a live read. Stage
  // 2 writes the Best Before Date to the *product*, so a wrong id there would
  // edit some other product's description — a silent, public mistake. Looking
  // it up also rejects a variant that does not exist at all.
  const live = await fetchStockRows(shop.shop_domain, shop.access_token, [body.variantId]);
  const row = live.get(body.variantId);
  if (!row) return c.json({ error: "no such product in this shop" }, 404);

  await addTrackedProduct(c.env.DB, {
    id: newId("tp"),
    shopId,
    shopifyVariantId: row.variantId,
    shopifyProductId: row.productId,
    addedAt: Math.floor(Date.now() / 1000),
  });
  return c.json({ ok: true });
});

stockRoutes.delete("/admin/api/stock/items/:variantId", requireAdminSession(), async (c) => {
  // Hono already percent-decodes path params (see HonoRequest#getDecodedParam),
  // so decoding again here would double-decode any value that legitimately
  // contained a "%" sequence. Shopify GIDs never do, but don't rely on that.
  await removeTrackedProduct(c.env.DB, c.get("shopId"), c.req.param("variantId"));
  return c.json({ ok: true });
});

interface SaveRow {
  variantId: string;
  stock: { value: number; compareQuantity: number };
  counted: boolean;
}

type ParsedSaveRow = { ok: true; row: SaveRow } | { ok: false; variantId: string; error: string };

// A `rows` entry can be anything a client sends — including `null`, or a
// shape missing `stock` entirely. Validating up front keeps every entry
// inside the per-row error boundary below: nothing in the save loop may
// throw past itself, because rows processed before a malformed one may
// already have written to Shopify, and losing `results` to an uncaught
// exception would tell the merchant nothing landed when some of it did.
function parseSaveRow(row: unknown): ParsedSaveRow {
  if (typeof row !== "object" || row === null) {
    return { ok: false, variantId: "unknown", error: "malformed row" };
  }
  const r = row as Record<string, unknown>;
  if (typeof r.variantId !== "string") {
    return { ok: false, variantId: "unknown", error: "malformed row" };
  }
  const stock = r.stock;
  if (
    typeof stock !== "object" ||
    stock === null ||
    typeof (stock as Record<string, unknown>).value !== "number" ||
    typeof (stock as Record<string, unknown>).compareQuantity !== "number"
  ) {
    return { ok: false, variantId: r.variantId, error: "stock value required" };
  }
  const { value, compareQuantity } = stock as { value: number; compareQuantity: number };
  return { ok: true, row: { variantId: r.variantId, stock: { value, compareQuantity }, counted: Boolean(r.counted) } };
}

stockRoutes.post("/admin/api/stock/save", requireAdminSession(), async (c) => {
  const shopId = c.get("shopId");
  const shop = await getShopById(c.env.DB, shopId);
  if (!shop) return c.json({ error: "shop not found" }, 404);

  const body = await c.req
    .json<{ locationId?: string; rows?: unknown[] }>()
    .catch(() => ({}) as { locationId?: string; rows?: unknown[] });
  const locationId = body.locationId;
  const rawRows = body.rows ?? [];
  if (!locationId) return c.json({ error: "locationId required" }, 400);
  if (!Array.isArray(rawRows) || rawRows.length === 0) return c.json({ error: "at least one row required" }, 400);

  // The set of variants this shop tracks is the authorisation boundary: a
  // request may only write to products the merchant has already put on their
  // own Stock tab.
  const tracked = new Set((await listTrackedProducts(c.env.DB, shopId)).map((t) => t.shopifyVariantId));

  const results: { variantId: string; ok: boolean; error?: string }[] = [];

  // Validate and authorise every row BEFORE touching Shopify, so a malformed
  // or untracked row can never reach the batch read below. `parsed` stays 1:1
  // with `rawRows` in input order — `results` is built from it in that order.
  const parsed = rawRows.map(parseSaveRow);
  const readIds = [
    ...new Set(parsed.flatMap((p) => (p.ok && tracked.has(p.row.variantId) ? [p.row.variantId] : []))),
  ];

  // One batched read for the whole save, purely to resolve inventoryItemId.
  // Reading per row cost 2 Shopify subrequests per row, which hit Cloudflare's
  // 50-subrequest cap at 25 rows — and failed MID-BATCH, after earlier rows
  // had already written. This is N+1 instead of 2N.
  //
  // It is deliberately NOT a source of comparison values: compareQuantity is
  // taken from the client payload and nowhere else, because it must be the
  // figure the merchant actually saw on screen or the staleness check it
  // exists to perform is meaningless.
  let live = new Map<string, StockRow>();
  let readError: unknown = null;
  if (readIds.length > 0) {
    try {
      live = await fetchStockRows(shop.shop_domain, shop.access_token, readIds);
    } catch (err) {
      // No write has happened yet, so this fails every row identically —
      // reported per row rather than as a 500, which would tell the merchant
      // nothing about which rows were even attempted.
      readError = err;
    }
  }

  for (const parsedRow of parsed) {
    if (!parsedRow.ok) {
      results.push({ variantId: parsedRow.variantId, ok: false, error: parsedRow.error });
      continue;
    }
    const row = parsedRow.row;

    if (!tracked.has(row.variantId)) {
      results.push({ variantId: row.variantId, ok: false, error: "product is not tracked by this shop" });
      continue;
    }

    try {
      if (readError) throw readError;
      const state = live.get(row.variantId);
      // Absent from the batch read = deleted in Shopify since it was tracked.
      if (!state) throw new Error("product no longer exists in Shopify");

      await setInventoryQuantity(shop.shop_domain, shop.access_token, {
        inventoryItemId: state.inventoryItemId,
        locationId,
        quantity: row.stock.value,
        compareQuantity: row.stock.compareQuantity,
      });

      if (row.counted) {
        await markCounted(c.env.DB, shopId, row.variantId, Math.floor(Date.now() / 1000));
      }
      results.push({ variantId: row.variantId, ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      // Translate Shopify's wording into something a merchant can act on —
      // never show a shop owner a GraphQL field name or mutation name.
      const friendly = /compareQuantity/i.test(message)
        ? "Stock changed since loading — refresh and count again"
        : message.replace(/^inventorySetQuantities userErrors:\s*/i, "");
      results.push({ variantId: row.variantId, ok: false, error: friendly });
    }
  }

  return c.json({ results });
});
