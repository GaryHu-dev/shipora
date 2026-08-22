import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";

async function tableNames(): Promise<string[]> {
  const { results } = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  ).all<{ name: string }>();
  return results.map((r) => r.name);
}

describe("stock event schema", () => {
  it("creates the new tables", async () => {
    const names = await tableNames();
    for (const t of ["material_code_map", "stock_events", "stock_event_lines"]) {
      expect(names).toContain(t);
    }
    // The old import-only tables are replaced, not kept alongside: two places
    // to look for "when did this stock change" is the thing the merge fixed.
    for (const gone of ["purchase_order_imports", "purchase_order_import_lines"]) {
      expect(names).not.toContain(gone);
    }
  });

  it("records a count with no filename, no PDF and no material code", async () => {
    // The columns an import needs are exactly the ones a count does not have.
    // If any of them were NOT NULL, a count could not be recorded at all.
    await env.DB.prepare(
      "INSERT INTO shops (id, shop_domain, access_token, join_secret, status, installed_at) VALUES (?,?,?,?,?,?)"
    ).bind("shop_3", "c.myshopify.com", "tok", "sec", "active", 1).run();
    await env.DB.prepare(
      "INSERT INTO stock_events (id, shop_id, kind, filename, pdf_r2_key, location_id, created_at) VALUES (?,?,?,?,?,?,?)"
    ).bind("evt_2", "shop_3", "count", null, null, "gid://shopify/Location/1", 2).run();
    await env.DB.prepare(
      `INSERT INTO stock_event_lines
       (id, event_id, material_code, description, shopify_variant_id, delivered_qty, qty_before, qty_after, sled, skipped, status, error)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind("line_2", "evt_2", null, "Anchor Butter", "gid://shopify/ProductVariant/9", null, 12, 8, null, 0, "ok", null).run();

    const row = await env.DB.prepare("SELECT * FROM stock_event_lines WHERE id = ?").bind("line_2").first<{ qty_before: number; qty_after: number }>();
    expect(row?.qty_before).toBe(12);
    expect(row?.qty_after).toBe(8); // a count can go DOWN; an import never does
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

  it("links event lines to their event via a foreign key column", async () => {
    await env.DB.prepare(
      "INSERT INTO shops (id, shop_domain, access_token, join_secret, status, installed_at) VALUES (?,?,?,?,?,?)"
    ).bind("shop_2", "b.myshopify.com", "tok", "sec", "active", 1).run();
    await env.DB.prepare(
      "INSERT INTO stock_events (id, shop_id, kind, filename, pdf_r2_key, location_id, created_at) VALUES (?,?,?,?,?,?,?)"
    ).bind("evt_1", "shop_2", "import", "delivery.pdf", "po/shop_2/po_1.pdf", "gid://shopify/Location/1", 1).run();
    await env.DB.prepare(
      `INSERT INTO stock_event_lines
       (id, event_id, material_code, description, shopify_variant_id, delivered_qty, qty_before, qty_after, sled, skipped, status, error)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind("line_1", "evt_1", "500123", "ACME MILK", "gid://shopify/ProductVariant/1", 10, 0, 10, "15.03.2027", 0, "ok", null).run();

    const row = await env.DB.prepare("SELECT * FROM stock_event_lines WHERE id = ?").bind("line_1").first();
    expect(row?.event_id).toBe("evt_1");
  });
});
