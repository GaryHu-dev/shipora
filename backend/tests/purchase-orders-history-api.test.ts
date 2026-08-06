import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { app } from "../src/index";
import { createImport } from "../src/db/purchaseOrderImports";
import { putPhoto } from "../src/r2";

// Same session-token minting as admin-api.test.ts — requireAdminSession()
// verifies a signed Shopify id token, so tests need a real (locally-signed) one.
function b64url(bytes: Uint8Array): string {
  let bin = ""; for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function mintIdToken(shop: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const claims = { iss: `https://${shop}/admin`, dest: `https://${shop}`, aud: env.SHOPIFY_API_KEY, sub: "1", exp: now + 60, nbf: now - 60, iat: now };
  const payload = b64url(new TextEncoder().encode(JSON.stringify(claims)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.SHOPIFY_API_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${header}.${payload}`)));
  return `${header}.${payload}.${b64url(sig)}`;
}
async function authHeaders(): Promise<{ Authorization: string }> {
  return { Authorization: `Bearer ${await mintIdToken("demo.myshopify.com")}` };
}

beforeEach(async () => {
  await env.DB.prepare(
    "INSERT INTO shops (id, shop_domain, access_token, join_secret, status, installed_at) VALUES (?,?,?,?,?,?)"
  ).bind("shop_1", "demo.myshopify.com", "tok", "sec", "active", 1).run();
});

async function seedImport() {
  await putPhoto(env.PHOTOS, "po/shop_1/po_1.pdf", new TextEncoder().encode("%PDF-fake").buffer as ArrayBuffer, "application/pdf");
  await createImport(env.DB, {
    id: "po_1", shopId: "shop_1", filename: "delivery.pdf", pdfR2Key: "po/shop_1/po_1.pdf",
    locationId: "gid://shopify/Location/1", importedAt: 100,
    lines: [{ id: "line_1", materialCode: "500123", description: "ACME MILK", shopifyVariantId: "gid://1", deliveredQty: 10, qtyBefore: 0, qtyAfter: 10, sled: "15.03.2027", expiryUpdated: true, skipped: false, status: "ok" }],
  });
}

describe("purchase order history routes", () => {
  it("GET /admin/api/purchase-orders lists imports for the shop", async () => {
    await seedImport();
    const res = await app.request("/admin/api/purchase-orders", { headers: await authHeaders() }, env);
    const body = await res.json() as { imports: { id: string }[] };
    expect(body.imports.map((i) => i.id)).toEqual(["po_1"]);
  });

  it("GET /admin/api/purchase-orders/:id returns the import and its lines", async () => {
    await seedImport();
    const res = await app.request("/admin/api/purchase-orders/po_1", { headers: await authHeaders() }, env);
    const body = await res.json() as { import: { id: string }; lines: { material_code: string }[] };
    expect(body.import.id).toBe("po_1");
    expect(body.lines).toHaveLength(1);
    expect(body.lines[0].material_code).toBe("500123");
  });

  it("GET /admin/api/purchase-orders/:id 404s for an import belonging to another shop", async () => {
    await seedImport();
    const res = await app.request("/admin/api/purchase-orders/no-such-import", { headers: await authHeaders() }, env);
    expect(res.status).toBe(404);
  });

  it("GET /admin/api/purchase-orders/:id/pdf streams the original PDF as an attachment", async () => {
    await seedImport();
    const res = await app.request("/admin/api/purchase-orders/po_1/pdf", { headers: await authHeaders() }, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain("attachment");
    expect(await res.text()).toBe("%PDF-fake");
  });
});
