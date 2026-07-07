import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { app } from "../src/index";
import { createShop } from "../src/db/shops";
import { upsertOrder } from "../src/db/orders";
import { createUser } from "../src/db/users";
import { createPhoto } from "../src/db/photos";
import { verifyToken } from "../src/auth/tokens";

function b64url(bytes: Uint8Array): string {
  let bin = ""; for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function mintIdToken(shop: string, over: Record<string, unknown> = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const claims = { iss: `https://${shop}/admin`, dest: `https://${shop}`, aud: env.SHOPIFY_API_KEY, sub: "1", exp: now + 60, nbf: now - 60, iat: now, ...over };
  const payload = b64url(new TextEncoder().encode(JSON.stringify(claims)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.SHOPIFY_API_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${header}.${payload}`)));
  return `${header}.${payload}.${b64url(sig)}`;
}

beforeEach(async () => {
  await createShop(env.DB, { id: "adm", shopDomain: "adm.myshopify.com", accessToken: "t", joinSecret: "j", installedAt: 1 });
  await upsertOrder(env.DB, { id: "ao", shopId: "adm", shopifyOrderId: "gid://a", orderNumber: "#A", customerName: "Ann", fulfillmentStatus: "unfulfilled", createdAt: 5, syncedAt: 5 });
});

describe("admin API", () => {
  it("401 without a session token", async () => {
    const res = await app.request("/admin/api/orders", {}, env);
    expect(res.status).toBe(401);
  });

  it("join-qr returns a PWA join link and a QR image", async () => {
    const token = await mintIdToken("adm.myshopify.com");
    const res = await app.request("/admin/api/join-qr", { method: "POST", headers: { Authorization: `Bearer ${token}` } }, env);
    expect(res.status).toBe(200);
    const { joinUrl, qrDataUrl } = await res.json<{ joinUrl: string; qrDataUrl: string }>();
    expect(joinUrl).toContain(`${env.PWA_URL}/#/join?token=`);
    expect(qrDataUrl.startsWith("data:image/")).toBe(true);
    const tokenValue = new URL(joinUrl.replace("/#/", "/")).searchParams.get("token")!;
    // Signed with the per-shop key (APP_SECRET + the shop's join_secret "j").
    const payload = await verifyToken(tokenValue, `${env.APP_SECRET}:j`, Math.floor(Date.now() / 1000));
    expect(payload).toMatchObject({ kind: "join", shop_id: "adm" });
  });

  it("lists the shop's orders", async () => {
    const token = await mintIdToken("adm.myshopify.com");
    const res = await app.request("/admin/api/orders?status=all", { headers: { Authorization: `Bearer ${token}` } }, env);
    const { orders } = await res.json<{ orders: { id: string }[] }>();
    expect(orders.map((o) => o.id)).toEqual(["ao"]);
  });

  it("401 when the shop is not installed", async () => {
    const token = await mintIdToken("ghost.myshopify.com");
    const res = await app.request("/admin/api/orders", { headers: { Authorization: `Bearer ${token}` } }, env);
    expect(res.status).toBe(401);
  });

  it("lists recent photos across orders, newest first", async () => {
    await createUser(env.DB, { id: "au", shopId: "adm", name: "A", joinedAt: 1 });
    await createPhoto(env.DB, { id: "ph_old", shopId: "adm", orderId: "ao", uploadedBy: "au", r2Key: "k1", thumbKey: null, note: null, uploadedAt: 10 });
    await createPhoto(env.DB, { id: "ph_new", shopId: "adm", orderId: "ao", uploadedBy: "au", r2Key: "k2", thumbKey: null, note: null, uploadedAt: 20 });
    const token = await mintIdToken("adm.myshopify.com");
    const res = await app.request("/admin/api/recent-photos", { headers: { Authorization: `Bearer ${token}` } }, env);
    expect(res.status).toBe(200);
    const { photos } = await res.json<{ photos: { id: string; order_number: string }[] }>();
    expect(photos.map((p) => p.id)).toEqual(["ph_new", "ph_old"]);
    expect(photos[0].order_number).toBe("#A");
  });

  it("gets and updates the retention setting", async () => {
    const token = await mintIdToken("adm.myshopify.com");
    const g = await app.request("/admin/api/settings", { headers: { Authorization: `Bearer ${token}` } }, env);
    expect(await g.json()).toEqual({ retentionDays: 30 });

    const p = await app.request("/admin/api/settings", {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ retentionDays: 7 }),
    }, env);
    expect(await p.json()).toEqual({ retentionDays: 7 });

    const g2 = await app.request("/admin/api/settings", { headers: { Authorization: `Bearer ${token}` } }, env);
    expect(await g2.json()).toEqual({ retentionDays: 7 });
  });

  it("rejects an out-of-range retention value", async () => {
    const token = await mintIdToken("adm.myshopify.com");
    const res = await app.request("/admin/api/settings", {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ retentionDays: 0 }),
    }, env);
    expect(res.status).toBe(400);
  });

  it("order-photos returns a signed view URL for each photo", async () => {
    await createUser(env.DB, { id: "au3", shopId: "adm", name: "A", joinedAt: 1 });
    await createPhoto(env.DB, { id: "ph_v", shopId: "adm", orderId: "ao", uploadedBy: "au3", r2Key: "kv", thumbKey: null, note: null, uploadedAt: 5 });
    const token = await mintIdToken("adm.myshopify.com");
    const res = await app.request("/admin/api/order-photos?gid=gid://a", { headers: { Authorization: `Bearer ${token}` } }, env);
    expect(res.status).toBe(200);
    const { photos } = await res.json<{ photos: { id: string; url: string }[] }>();
    expect(photos).toHaveLength(1);
    expect(photos[0].url).toContain("/p/ph_v");
  });

  it("short photo URL 404s for an unknown id", async () => {
    const res = await app.request("/p/nope", {}, env);
    expect(res.status).toBe(404);
  });

  it("cleanup deletes photos past the shop's retention", async () => {
    await createUser(env.DB, { id: "au2", shopId: "adm", name: "A", joinedAt: 1 });
    await createPhoto(env.DB, { id: "ph_exp", shopId: "adm", orderId: "ao", uploadedBy: "au2", r2Key: "kx", thumbKey: null, note: null, uploadedAt: 1 });
    const token = await mintIdToken("adm.myshopify.com");
    const res = await app.request("/admin/api/cleanup", { method: "POST", headers: { Authorization: `Bearer ${token}` } }, env);
    const { deleted } = await res.json<{ deleted: number }>();
    expect(deleted).toBeGreaterThanOrEqual(1);
  });
});
