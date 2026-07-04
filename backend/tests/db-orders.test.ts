import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { createShop } from "../src/db/shops";
import { upsertOrder, listOrders } from "../src/db/orders";

async function seed() {
  await createShop(env.DB, { id: "s1", shopDomain: "s1.myshopify.com", accessToken: "t", joinSecret: "j", installedAt: 1 });
  await upsertOrder(env.DB, { id: "o1", shopId: "s1", shopifyOrderId: "gid://1", orderNumber: "#1001", customerName: "Alice", fulfillmentStatus: "unfulfilled", createdAt: 10, syncedAt: 10 });
  await upsertOrder(env.DB, { id: "o2", shopId: "s1", shopifyOrderId: "gid://2", orderNumber: "#1002", customerName: "Bob", fulfillmentStatus: "fulfilled", createdAt: 20, syncedAt: 20 });
}

describe("orders db", () => {
  beforeEach(seed);

  it("defaults to unfulfilled only", async () => {
    const rows = await listOrders(env.DB, "s1", {});
    expect(rows.map((r) => r.id)).toEqual(["o1"]);
  });

  it("returns all when status=all, newest first", async () => {
    const rows = await listOrders(env.DB, "s1", { status: "all" });
    expect(rows.map((r) => r.id)).toEqual(["o2", "o1"]);
  });

  it("filters fulfilled", async () => {
    const rows = await listOrders(env.DB, "s1", { status: "fulfilled" });
    expect(rows.map((r) => r.id)).toEqual(["o2"]);
  });

  it("searches by order number or customer name", async () => {
    expect((await listOrders(env.DB, "s1", { status: "all", q: "1002" })).map((r) => r.id)).toEqual(["o2"]);
    expect((await listOrders(env.DB, "s1", { status: "all", q: "ali" })).map((r) => r.id)).toEqual(["o1"]);
  });

  it("upsert updates fulfillment status in place", async () => {
    await upsertOrder(env.DB, { id: "o1", shopId: "s1", shopifyOrderId: "gid://1", orderNumber: "#1001", customerName: "Alice", fulfillmentStatus: "fulfilled", createdAt: 10, syncedAt: 30 });
    const rows = await listOrders(env.DB, "s1", { status: "all" });
    expect(rows.length).toBe(2);
    expect(rows.find((r) => r.shopify_order_id === "gid://1")!.fulfillment_status).toBe("fulfilled");
  });
});
