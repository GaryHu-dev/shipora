import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";

async function tableNames(): Promise<string[]> {
  const { results } = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  ).all<{ name: string }>();
  return results.map((r) => r.name);
}

describe("schema", () => {
  it("creates all core tables", async () => {
    const names = await tableNames();
    for (const t of ["shops", "users", "orders", "shipment_photos"]) {
      expect(names).toContain(t);
    }
  });

  it("enforces unique shopify_order_id per shop", async () => {
    await env.DB.prepare(
      "INSERT INTO shops (id, shop_domain, access_token, join_secret, status, installed_at) VALUES (?,?,?,?,?,?)"
    ).bind("shop_1", "a.myshopify.com", "tok", "sec", "active", 1).run();
    const insert = (n: string) =>
      env.DB.prepare(
        "INSERT INTO orders (id, shop_id, shopify_order_id, order_number, customer_name, fulfillment_status, created_at, synced_at) VALUES (?,?,?,?,?,?,?,?)"
      ).bind(n, "shop_1", "gid://123", "#1001", "Jo", "unfulfilled", 1, 1).run();
    await insert("o1");
    await expect(insert("o2")).rejects.toThrow();
  });
});
