import { env, fetchMock } from "cloudflare:test";
import { describe, it, expect, beforeAll, afterEach, beforeEach } from "vitest";
import { SHOPIFY_API_VERSION } from "../src/shopify/graphql";
import { checkSyncHealth } from "../src/shopify/syncHealth";
import { upsertOrder } from "../src/db/orders";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

function mockGraphQL(response: unknown) {
  fetchMock
    .get("https://demo.myshopify.com")
    .intercept({ path: `/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, method: "POST" })
    .reply(200, JSON.stringify(response));
}

const SHOP = { id: "shop_1", shop_domain: "demo.myshopify.com", access_token: "tok" };

beforeEach(async () => {
  await env.DB.prepare(
    "INSERT INTO shops (id, shop_domain, access_token, join_secret, status, installed_at) VALUES (?,?,?,?,?,?)"
  ).bind("shop_1", "demo.myshopify.com", "tok", "sec", "active", 1).run();
});

function shopifyOrders(...ids: string[]) {
  return {
    data: {
      orders: {
        edges: ids.map((id, i) => ({
          node: { id: `gid://shopify/Order/${id}`, name: `#${id}`, createdAt: `2026-08-1${i}T00:00:00Z` },
        })),
      },
    },
  };
}

async function hold(id: string, at: number) {
  await upsertOrder(env.DB, {
    id: `order_${id}`, shopId: "shop_1", shopifyOrderId: `gid://shopify/Order/${id}`,
    orderNumber: `#${id}`, customerName: null, fulfillmentStatus: "unfulfilled",
    createdAt: at, syncedAt: at,
  });
}

describe("checkSyncHealth", () => {
  it("reports nothing missing when we hold everything Shopify has", async () => {
    await hold("7401", 300); await hold("7400", 200);
    mockGraphQL(shopifyOrders("7401", "7400"));

    const h = await checkSyncHealth(env.DB, SHOP);
    expect(h.missing).toBe(0);
    expect(h.shopifyNewest).toBe("#7401");
    expect(h.ourNewest).toBe("#7401");
  });

  it("counts the orders Shopify has that we do not", async () => {
    // The outage this exists to catch: webhooks stopped, so the newest orders
    // never arrived and the shop merely looked quiet.
    await hold("7398", 100);
    mockGraphQL(shopifyOrders("7401", "7400", "7399", "7398"));

    const h = await checkSyncHealth(env.DB, SHOP);
    expect(h.missing).toBe(3);
    expect(h.shopifyNewest).toBe("#7401");
    expect(h.ourNewest).toBe("#7398");
  });

  it("does not mistake a genuinely quiet shop for a broken one", async () => {
    // Same database state as a long-stale sync — nothing recorded for ages —
    // but Shopify has nothing newer either, so this is healthy and must not
    // raise an alarm. A "time since last order" metric cannot tell these apart.
    await hold("7398", 1);
    mockGraphQL(shopifyOrders("7398"));

    const h = await checkSyncHealth(env.DB, SHOP);
    expect(h.missing).toBe(0);
    expect(h.lastSyncedAt).toBe(1);
  });

  it("handles a shop that holds no orders at all", async () => {
    mockGraphQL(shopifyOrders("7401"));
    const h = await checkSyncHealth(env.DB, SHOP);
    expect(h).toMatchObject({ missing: 1, shopifyNewest: "#7401", ourNewest: null, lastSyncedAt: null });
  });
});
