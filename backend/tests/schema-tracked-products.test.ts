import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";

describe("tracked_products schema", () => {
  it("creates the table with its columns", async () => {
    const { results } = await env.DB.prepare("PRAGMA table_info(tracked_products)").all<{ name: string }>();
    expect(results.map((r) => r.name).sort()).toEqual(
      ["added_at", "id", "last_bbd_checked_at", "last_counted_at", "shop_id", "shopify_product_id", "shopify_variant_id"]
    );
  });

  it("enforces one row per shop + variant", async () => {
    await env.DB.prepare(
      "INSERT INTO shops (id, shop_domain, access_token, join_secret, status, installed_at) VALUES (?,?,?,?,?,?)"
    ).bind("shop_dup", "dup.myshopify.com", "tok", "sec", "active", 1).run();

    const insert = (id: string) =>
      env.DB.prepare(
        "INSERT INTO tracked_products (id, shop_id, shopify_variant_id, shopify_product_id, added_at) VALUES (?,?,?,?,?)"
      ).bind(id, "shop_dup", "gid://shopify/ProductVariant/1", "gid://shopify/Product/1", 1).run();

    await insert("tp_1");
    await expect(insert("tp_2")).rejects.toThrow();
  });
});
