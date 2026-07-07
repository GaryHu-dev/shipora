import { env, fetchMock } from "cloudflare:test";
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { app } from "../src/index";
import { getShopById } from "../src/db/shops";
import { signToken } from "../src/auth/tokens";
import { SHOPIFY_API_VERSION } from "../src/shopify/graphql";

beforeAll(() => { fetchMock.activate(); fetchMock.disableNetConnect(); });
afterEach(() => fetchMock.assertNoPendingInterceptors());

function now() { return Math.floor(Date.now() / 1000); }

// Build a valid signed OAuth callback query for a given shop + state.
async function signedCallback(shop: string, state: string): Promise<string> {
  const base = new URLSearchParams({ code: "authcode", shop, state, timestamp: String(now()) });
  const pairs = [...base].map(([k, v]) => `${k}=${v}`).sort().join("&");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.SHOPIFY_API_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(pairs)));
  const hmac = [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
  base.set("hmac", hmac);
  return base.toString();
}

describe("GET /auth", () => {
  it("redirects to Shopify authorize with the right params", async () => {
    const res = await app.request("/auth?shop=demo.myshopify.com", {}, env);
    expect(res.status).toBe(302);
    const loc = res.headers.get("location")!;
    expect(loc).toContain("https://demo.myshopify.com/admin/oauth/authorize");
    expect(loc).toContain(`client_id=${env.SHOPIFY_API_KEY}`);
    expect(loc).toContain("state=");
  });

  it("400 for a non-myshopify domain", async () => {
    const res = await app.request("/auth?shop=evil.example.com", {}, env);
    expect(res.status).toBe(400);
  });
});

describe("GET /auth/callback", () => {
  it("exchanges the code, stores the shop, and syncs orders", async () => {
    const shop = "demo.myshopify.com";
    const state = await signToken({ kind: "oauth", shop }, env.APP_SECRET, 600, now());

    fetchMock.get("https://demo.myshopify.com")
      .intercept({ path: "/admin/oauth/access_token", method: "POST" })
      .reply(200, JSON.stringify({ access_token: "shpat_xxx", scope: "read_orders,write_orders" }));
    fetchMock.get("https://demo.myshopify.com")
      .intercept({ path: `/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, method: "POST" })
      .reply(200, JSON.stringify({ data: { orders: { edges: [], pageInfo: { hasNextPage: false } } } }));

    const qs = await signedCallback(shop, state);
    const res = await app.request(`/auth/callback?${qs}`, {}, env);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain(`https://${shop}/admin/apps/`);

    const stored = await env.DB.prepare("SELECT * FROM shops WHERE shop_domain = ?").bind(shop).first<{ id: string; access_token: string }>();
    expect(stored?.access_token).toBe("shpat_xxx");
    expect(await getShopById(env.DB, stored!.id)).not.toBeNull();
  });

  it("401 when the state token is invalid", async () => {
    const qs = await signedCallback("demo.myshopify.com", "not-a-real-state");
    const res = await app.request(`/auth/callback?${qs}`, {}, env);
    expect(res.status).toBe(401);
  });
});
