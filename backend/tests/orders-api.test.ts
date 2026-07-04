import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import app from "../src/index";
import { createShop } from "../src/db/shops";
import { createUser } from "../src/db/users";
import { upsertOrder } from "../src/db/orders";
import { issueSession } from "../src/auth/session";

function now() {
  return Math.floor(Date.now() / 1000);
}

async function seedTwoShops() {
  await createShop(env.DB, { id: "A", shopDomain: "a.myshopify.com", accessToken: "t", joinSecret: "j", installedAt: 1 });
  await createShop(env.DB, { id: "B", shopDomain: "b.myshopify.com", accessToken: "t", joinSecret: "j", installedAt: 1 });
  await createUser(env.DB, { id: "ua", shopId: "A", name: "A-staff", joinedAt: 1 });
  await createUser(env.DB, { id: "ub", shopId: "B", name: "B-staff", joinedAt: 1 });
  await upsertOrder(env.DB, { id: "a1", shopId: "A", shopifyOrderId: "gid://a1", orderNumber: "#A1", customerName: "Ann", fulfillmentStatus: "unfulfilled", createdAt: 10, syncedAt: 10 });
  await upsertOrder(env.DB, { id: "b1", shopId: "B", shopifyOrderId: "gid://b1", orderNumber: "#B1", customerName: "Ben", fulfillmentStatus: "unfulfilled", createdAt: 10, syncedAt: 10 });
}

async function get(path: string, token: string) {
  return app.request(path, { headers: { Authorization: `Bearer ${token}` } }, env);
}

describe("GET /api/orders", () => {
  it("401 without a session", async () => {
    const res = await app.request("/api/orders", {}, env);
    expect(res.status).toBe(401);
  });

  it("returns only the caller's shop orders (isolation)", async () => {
    await seedTwoShops();
    const tokenA = await issueSession(env.APP_SECRET, { userId: "ua", shopId: "A" }, now());
    const res = await get("/api/orders?status=all", tokenA);
    expect(res.status).toBe(200);
    const data = await res.json<{ orders: { id: string }[] }>();
    expect(data.orders.map((o) => o.id)).toEqual(["a1"]);
  });

  it("defaults to unfulfilled", async () => {
    await seedTwoShops();
    await upsertOrder(env.DB, { id: "a2", shopId: "A", shopifyOrderId: "gid://a2", orderNumber: "#A2", customerName: "Al", fulfillmentStatus: "fulfilled", createdAt: 5, syncedAt: 5 });
    const tokenA = await issueSession(env.APP_SECRET, { userId: "ua", shopId: "A" }, now());
    const res = await get("/api/orders", tokenA);
    const data = await res.json<{ orders: { id: string }[] }>();
    expect(data.orders.map((o) => o.id)).toEqual(["a1"]);
  });
});
