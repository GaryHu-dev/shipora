import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import app from "../src/index";
import { createShop, getShopById } from "../src/db/shops";
import { listOrders } from "../src/db/orders";

async function b64(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  let bin = ""; for (const x of new Uint8Array(sig)) bin += String.fromCharCode(x);
  return btoa(bin);
}

async function send(topic: string, shopDomain: string, body: object, opts: { badHmac?: boolean } = {}) {
  const raw = JSON.stringify(body);
  const hmac = opts.badHmac ? "bad" : await b64(env.SHOPIFY_API_SECRET, raw);
  return app.request(`/webhooks/${topic}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Shopify-Hmac-Sha256": hmac,
      "X-Shopify-Shop-Domain": shopDomain,
    },
    body: raw,
  }, env);
}

describe("POST /webhooks/:topic", () => {
  it("401 on bad HMAC", async () => {
    const res = await send("orders/create", "wh.myshopify.com", { id: 1 }, { badHmac: true });
    expect(res.status).toBe(401);
  });

  it("orders/create upserts the order", async () => {
    await createShop(env.DB, { id: "wh1", shopDomain: "wh.myshopify.com", accessToken: "t", joinSecret: "j", installedAt: 1 });
    const res = await send("orders/create", "wh.myshopify.com", {
      admin_graphql_api_id: "gid://order/50",
      name: "#5000",
      created_at: "2026-06-10T00:00:00Z",
      fulfillment_status: null,
      customer: { first_name: "Sam", last_name: "Lee" },
    });
    expect(res.status).toBe(200);
    const orders = await listOrders(env.DB, "wh1", { status: "all" });
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ order_number: "#5000", customer_name: "Sam Lee", fulfillment_status: "unfulfilled" });
  });

  it("app/uninstalled marks the shop uninstalled", async () => {
    await createShop(env.DB, { id: "wh2", shopDomain: "wh2.myshopify.com", accessToken: "t", joinSecret: "j", installedAt: 1 });
    const res = await send("app/uninstalled", "wh2.myshopify.com", { id: 999 });
    expect(res.status).toBe(200);
    expect((await getShopById(env.DB, "wh2"))?.status).toBe("uninstalled");
  });
});
