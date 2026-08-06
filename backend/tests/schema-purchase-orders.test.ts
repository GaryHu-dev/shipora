import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";

async function tableNames(): Promise<string[]> {
  const { results } = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  ).all<{ name: string }>();
  return results.map((r) => r.name);
}

describe("purchase order schema", () => {
  it("creates the new tables", async () => {
    const names = await tableNames();
    for (const t of ["material_code_map", "purchase_order_imports", "purchase_order_import_lines"]) {
      expect(names).toContain(t);
    }
  });

  it("enforces one material_code per shop", async () => {
    await env.DB.prepare(
      "INSERT INTO shops (id, shop_domain, access_token, join_secret, status, installed_at) VALUES (?,?,?,?,?,?)"
    ).bind("shop_1", "a.myshopify.com", "tok", "sec", "active", 1).run();
    const insert = (id: string) =>
      env.DB.prepare(
        "INSERT INTO material_code_map (id, shop_id, material_code, shopify_variant_id, updated_at) VALUES (?,?,?,?,?)"
      ).bind(id, "shop_1", "500123", "gid://shopify/ProductVariant/1", 1).run();
    await insert("map_1");
    await expect(insert("map_2")).rejects.toThrow();
  });

  it("links import lines to their import via a foreign key column", async () => {
    await env.DB.prepare(
      "INSERT INTO shops (id, shop_domain, access_token, join_secret, status, installed_at) VALUES (?,?,?,?,?,?)"
    ).bind("shop_2", "b.myshopify.com", "tok", "sec", "active", 1).run();
    await env.DB.prepare(
      "INSERT INTO purchase_order_imports (id, shop_id, filename, pdf_r2_key, location_id, imported_at) VALUES (?,?,?,?,?,?)"
    ).bind("po_1", "shop_2", "delivery.pdf", "po/shop_2/po_1.pdf", "gid://shopify/Location/1", 1).run();
    await env.DB.prepare(
      `INSERT INTO purchase_order_import_lines
       (id, import_id, material_code, description, shopify_variant_id, delivered_qty, qty_before, qty_after, sled, expiry_updated, skipped, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind("line_1", "po_1", "500123", "ACME MILK", "gid://shopify/ProductVariant/1", 10, 0, 10, "15.03.2027", 1, 0, "ok").run();

    const row = await env.DB.prepare("SELECT * FROM purchase_order_import_lines WHERE id = ?").bind("line_1").first();
    expect(row?.import_id).toBe("po_1");
  });
});
