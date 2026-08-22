import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { createStockEvent, listStockEvents, getStockEventForShop, listStockEventLines } from "../src/db/stockEvents";

beforeEach(async () => {
  await env.DB.prepare(
    "INSERT INTO shops (id, shop_domain, access_token, join_secret, status, installed_at) VALUES (?,?,?,?,?,?)"
  ).bind("shop_1", "a.myshopify.com", "tok", "sec", "active", 1).run();
});

function sampleLines(idPrefix = "") {
  return [
    { id: `${idPrefix}line_1`, materialCode: "500123", description: "ACME MILK", productTitle: "ACME MILK", shopifyVariantId: "gid://1", deliveredQty: 10, qtyBefore: 0, qtyAfter: 10, sled: "15.03.2027", skipped: false, status: "ok" as const, error: null },
    { id: `${idPrefix}line_2`, materialCode: "500456", description: "ACME YOGURT", productTitle: "ACME YOGURT", shopifyVariantId: null, deliveredQty: 4, qtyBefore: null, qtyAfter: null, sled: "01.04.2027", skipped: true, status: "ok" as const, error: null },
  ];
}

describe("purchase order imports", () => {
  it("creates an import with its lines", async () => {
    await createStockEvent(env.DB, {
      id: "po_1", shopId: "shop_1", kind: "import" as const, filename: "delivery.pdf", pdfR2Key: "po/shop_1/po_1.pdf",
      locationId: "gid://shopify/Location/1", createdAt: 100, lines: sampleLines(),
    });
    const lines = await listStockEventLines(env.DB, "po_1");
    expect(lines).toHaveLength(2);
    expect(lines[0].material_code).toBe("500123");
    expect(lines[1].skipped).toBe(1);
  });

  it("lists imports for a shop, newest first, with per-import counts", async () => {
    await createStockEvent(env.DB, {
      id: "po_1", shopId: "shop_1", kind: "import" as const, filename: "delivery-1.pdf", pdfR2Key: "po/shop_1/po_1.pdf",
      locationId: "gid://shopify/Location/1", createdAt: 100, lines: sampleLines(),
    });
    await createStockEvent(env.DB, {
      id: "po_2", shopId: "shop_1", kind: "import" as const, filename: "delivery-2.pdf", pdfR2Key: "po/shop_1/po_2.pdf",
      locationId: "gid://shopify/Location/1", createdAt: 200, lines: sampleLines("po2_"),
    });

    const imports = await listStockEvents(env.DB, "shop_1", {});
    expect(imports.map((i) => i.id)).toEqual(["po_2", "po_1"]);
    expect(imports[0]).toMatchObject({ line_count: 2, ok_count: 1, skipped_count: 1, error_count: 0 });
  });

  it("scopes listImports and getImportByIdForShop by shop", async () => {
    await env.DB.prepare(
      "INSERT INTO shops (id, shop_domain, access_token, join_secret, status, installed_at) VALUES (?,?,?,?,?,?)"
    ).bind("shop_2", "b.myshopify.com", "tok", "sec", "active", 1).run();
    await createStockEvent(env.DB, {
      id: "po_1", shopId: "shop_1", kind: "import" as const, filename: "delivery.pdf", pdfR2Key: "po/shop_1/po_1.pdf",
      locationId: "gid://shopify/Location/1", createdAt: 100, lines: sampleLines(),
    });

    expect(await listStockEvents(env.DB, "shop_2", {})).toEqual([]);
    expect(await getStockEventForShop(env.DB, "shop_2", "po_1")).toBeNull();
    expect(await getStockEventForShop(env.DB, "shop_1", "po_1")).not.toBeNull();
  });
});
