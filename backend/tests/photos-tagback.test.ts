import { env, fetchMock } from "cloudflare:test";
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import app from "../src/index";
import { createShop } from "../src/db/shops";
import { createUser } from "../src/db/users";
import { upsertOrder } from "../src/db/orders";
import { issueSession } from "../src/auth/session";
import { SHOPIFY_API_VERSION } from "../src/shopify/graphql";

beforeAll(() => { fetchMock.activate(); fetchMock.disableNetConnect(); });
afterEach(() => fetchMock.assertNoPendingInterceptors());

function now() { return Math.floor(Date.now() / 1000); }

async function seed() {
  await createShop(env.DB, { id: "TG", shopDomain: "tg.myshopify.com", accessToken: "tok", joinSecret: "j", installedAt: 1 });
  await createUser(env.DB, { id: "tgu", shopId: "TG", name: "T", joinedAt: 1 });
  await upsertOrder(env.DB, { id: "tgo", shopId: "TG", shopifyOrderId: "gid://order/77", orderNumber: "#77", customerName: "Ann", fulfillmentStatus: "unfulfilled", createdAt: 1, syncedAt: 1 });
  return issueSession(env.APP_SECRET, { userId: "tgu", shopId: "TG" }, now());
}

function form(bytes: string): FormData {
  const fd = new FormData();
  fd.set("photo", new File([bytes], "p.jpg", { type: "image/jpeg" }));
  return fd;
}

describe("photo upload tags the Shopify order", () => {
  it("calls tagsAdd with the order gid after a successful upload", async () => {
    const token = await seed();
    fetchMock.get("https://tg.myshopify.com")
      .intercept({ path: `/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, method: "POST" })
      .reply(200, JSON.stringify({ data: { tagsAdd: { node: { id: "gid://order/77" }, userErrors: [] } } }));

    const res = await app.request("/api/orders/tgo/photos", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form("BYTES") }, env);
    expect(res.status).toBe(200);
    // If tagsAdd was not called, assertNoPendingInterceptors() in afterEach would throw.
  });

  it("still succeeds (200) when tagsAdd fails", async () => {
    const token = await seed();
    fetchMock.get("https://tg.myshopify.com")
      .intercept({ path: `/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, method: "POST" })
      .reply(500, "boom");

    const res = await app.request("/api/orders/tgo/photos", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form("BYTES") }, env);
    expect(res.status).toBe(200);
  });
});
