import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { app } from "../src/index";
import { createShop } from "../src/db/shops";

beforeEach(async () => {
  await createShop(env.DB, { id: "qshop", shopDomain: "q.myshopify.com", accessToken: "t", joinSecret: "j", installedAt: 1 });
});

describe("GET /qr (standalone admin QR page)", () => {
  it("401 without the admin key", async () => {
    const res = await app.request("/qr?shop=q.myshopify.com", {}, env);
    expect(res.status).toBe(401);
  });

  it("401 with a wrong key", async () => {
    const res = await app.request("/qr?key=nope&shop=q.myshopify.com", {}, env);
    expect(res.status).toBe(401);
  });

  it("404 when the shop is unknown", async () => {
    const res = await app.request(`/qr?key=${env.ADMIN_KEY}&shop=ghost.myshopify.com`, {}, env);
    expect(res.status).toBe(404);
  });

  it("renders a QR page with the join link for a valid key + shop", async () => {
    const res = await app.request(`/qr?key=${env.ADMIN_KEY}&shop=q.myshopify.com`, {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("data:image/");
    expect(html).toContain(`${env.PWA_URL}/#/join?token=`);
  });
});
