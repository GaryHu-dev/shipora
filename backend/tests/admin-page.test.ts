import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { app } from "../src/index";
import { createShop } from "../src/db/shops";

describe("GET /admin", () => {
  it("serves an embeddable HTML page with the API key and frame-ancestors CSP", async () => {
    await createShop(env.DB, { id: "adm-page", shopDomain: "demo.myshopify.com", accessToken: "t", joinSecret: "j", installedAt: 1 });
    const res = await app.request("/admin?shop=demo.myshopify.com&host=abc", {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors");
    const html = await res.text();
    expect(html).toContain(env.SHOPIFY_API_KEY);
    expect(html).toContain("app-bridge");
  });

  it("redirects to OAuth when the shop is not installed yet", async () => {
    const res = await app.request("/admin?shop=fresh-store.myshopify.com&host=abc", {}, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("/admin/oauth/authorize");
    expect(html).not.toContain("app-bridge");
  });

  it("includes the Import tab and its upload form", async () => {
    await createShop(env.DB, { id: "adm-page-import", shopDomain: "demo.myshopify.com", accessToken: "t", joinSecret: "j", installedAt: 1 });
    const res = await app.request("/admin?shop=demo.myshopify.com", {}, env);
    const html = await res.text();
    expect(html).toContain('id="tab-import"');
    expect(html).toContain('id="poFile"');
    expect(html).toContain("/admin/api/purchase-orders/parse");
    expect(html).toContain("/admin/api/purchase-orders/confirm");
  });

  it("includes the History tab and its list container", async () => {
    await createShop(env.DB, { id: "adm-page-history", shopDomain: "demo.myshopify.com", accessToken: "t", joinSecret: "j", installedAt: 1 });
    const res = await app.request("/admin?shop=demo.myshopify.com", {}, env);
    const html = await res.text();
    expect(html).toContain('id="tab-history"');
    expect(html).toContain('id="poHistoryList"');
    expect(html).toContain("/admin/api/purchase-orders");
  });
});
