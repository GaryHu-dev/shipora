import { env, fetchMock } from "cloudflare:test";
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { createShop } from "../src/db/shops";
import { listOrders } from "../src/db/orders";
import { syncRecentOrders, mapFulfillment } from "../src/shopify/ordersSync";
import { SHOPIFY_API_VERSION } from "../src/shopify/graphql";

beforeAll(() => { fetchMock.activate(); fetchMock.disableNetConnect(); });
afterEach(() => fetchMock.assertNoPendingInterceptors());

const ORDERS_PAYLOAD = {
  data: {
    orders: {
      edges: [
        { cursor: "c1", node: { id: "gid://order/1", name: "#1001", createdAt: "2026-06-01T00:00:00Z", displayFulfillmentStatus: "UNFULFILLED", customer: { displayName: "Alice" } } },
        { cursor: "c2", node: { id: "gid://order/2", name: "#1002", createdAt: "2026-06-02T00:00:00Z", displayFulfillmentStatus: "FULFILLED", customer: null } },
      ],
      pageInfo: { hasNextPage: false },
    },
  },
};

describe("mapFulfillment", () => {
  it("maps FULFILLED to fulfilled and others to unfulfilled", () => {
    expect(mapFulfillment("FULFILLED")).toBe("fulfilled");
    expect(mapFulfillment("UNFULFILLED")).toBe("unfulfilled");
    expect(mapFulfillment("PARTIALLY_FULFILLED")).toBe("unfulfilled");
  });
});

describe("syncRecentOrders", () => {
  it("upserts fetched orders into D1", async () => {
    await createShop(env.DB, { id: "sync1", shopDomain: "demo.myshopify.com", accessToken: "tok", joinSecret: "j", installedAt: 1 });
    fetchMock
      .get("https://demo.myshopify.com")
      .intercept({ path: `/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, method: "POST" })
      .reply(200, JSON.stringify(ORDERS_PAYLOAD));

    const count = await syncRecentOrders(env.DB, { id: "sync1", shop_domain: "demo.myshopify.com", access_token: "tok" }, 1_750_000_000);
    expect(count).toBe(2);

    const all = await listOrders(env.DB, "sync1", { status: "all" });
    expect(all.map((o) => o.order_number).sort()).toEqual(["#1001", "#1002"]);
    const o1 = all.find((o) => o.shopify_order_id === "gid://order/1")!;
    expect(o1.customer_name).toBe("Alice");
    expect(o1.fulfillment_status).toBe("unfulfilled");
    const o2 = all.find((o) => o.shopify_order_id === "gid://order/2")!;
    expect(o2.customer_name).toBeNull();
    expect(o2.fulfillment_status).toBe("fulfilled");
  });
});
