import { env, fetchMock } from "cloudflare:test";
import { describe, it, expect, beforeAll, afterEach, beforeEach } from "vitest";
import { app } from "../src/index";
import { SHOPIFY_API_VERSION } from "../src/shopify/graphql";
import { upsertMaterialCodeMap, getVariantIdForMaterialCode } from "../src/db/materialCodeMap";

beforeAll(() => { fetchMock.activate(); fetchMock.disableNetConnect(); });
afterEach(() => fetchMock.assertNoPendingInterceptors());

function mockGraphQL(response: unknown) {
  fetchMock.get("https://demo.myshopify.com")
    .intercept({ path: `/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, method: "POST" })
    .reply(200, JSON.stringify(response));
}

function b64url(bytes: Uint8Array): string {
  let bin = ""; for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function authHeaders(): Promise<{ Authorization: string }> {
  const now = Math.floor(Date.now() / 1000);
  const shop = "demo.myshopify.com";
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const claims = { iss: `https://${shop}/admin`, dest: `https://${shop}`, aud: env.SHOPIFY_API_KEY, sub: "1", exp: now + 60, nbf: now - 60, iat: now };
  const payload = b64url(new TextEncoder().encode(JSON.stringify(claims)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.SHOPIFY_API_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${header}.${payload}`)));
  return { Authorization: `Bearer ${header}.${payload}.${b64url(sig)}` };
}

const V1 = "gid://shopify/ProductVariant/1";

const variantNode = () => ({
  id: V1, sku: "122352", displayName: "Anchor Butter Salted - Default Title", image: null,
  inventoryItem: { id: "gid://shopify/InventoryItem/9", inventoryLevels: { edges: [] } },
  product: { id: "gid://shopify/Product/5", title: "Anchor Butter Salted", featuredImage: { url: "https://img/1.png" }, descriptionHtml: "" },
});

beforeEach(async () => {
  await env.DB.prepare(
    "INSERT INTO shops (id, shop_domain, access_token, join_secret, status, installed_at) VALUES (?,?,?,?,?,?)"
  ).bind("shop_1", "demo.myshopify.com", "tok", "sec", "active", 1).run();
});

describe("material code mappings", () => {
  it("rejects an unauthenticated request", async () => {
    expect((await app.request("/admin/api/material-codes", {}, env)).status).toBe(401);
  });

  it("resolves each mapping to a product rather than returning bare ids", async () => {
    // A list of gids cannot be audited, which would leave a wrong mapping just
    // as invisible as it was before this screen existed.
    await upsertMaterialCodeMap(env.DB, { id: "m1", shopId: "shop_1", materialCode: "122352", shopifyVariantId: V1, updatedAt: 100 });
    mockGraphQL({ data: { nodes: [variantNode()] } });

    const res = await app.request("/admin/api/material-codes", { headers: await authHeaders() }, env);
    const body = await res.json<{ mappings: Record<string, unknown>[] }>();
    expect(body.mappings).toHaveLength(1);
    expect(body.mappings[0]).toMatchObject({
      materialCode: "122352", title: "Anchor Butter Salted", sku: "122352", missing: false,
    });
  });

  it("flags a mapping whose product no longer exists", async () => {
    // It would still match on the next import and then fail at the write, so
    // it has to be visible as broken before that happens.
    await upsertMaterialCodeMap(env.DB, { id: "m1", shopId: "shop_1", materialCode: "999", shopifyVariantId: V1, updatedAt: 100 });
    mockGraphQL({ data: { nodes: [null] } });

    const res = await app.request("/admin/api/material-codes", { headers: await authHeaders() }, env);
    const body = await res.json<{ mappings: { missing: boolean; title: string | null }[] }>();
    expect(body.mappings[0]).toMatchObject({ missing: true, title: null });
  });

  it("adds a mapping by hand, after checking the product exists", async () => {
    mockGraphQL({ data: { nodes: [variantNode()] } });
    const res = await app.request("/admin/api/material-codes", {
      method: "POST",
      headers: { ...(await authHeaders()), "content-type": "application/json" },
      body: JSON.stringify({ materialCode: " 122352 ", variantId: V1 }),
    }, env);

    expect(res.status).toBe(200);
    // Trimmed: a stray space would make it a different code and never match.
    expect(await getVariantIdForMaterialCode(env.DB, "shop_1", "122352")).toBe(V1);
  });

  it("refuses a mapping to a product this shop does not have", async () => {
    mockGraphQL({ data: { nodes: [null] } });
    const res = await app.request("/admin/api/material-codes", {
      method: "POST",
      headers: { ...(await authHeaders()), "content-type": "application/json" },
      body: JSON.stringify({ materialCode: "555", variantId: V1 }),
    }, env);

    expect(res.status).toBe(404);
    expect(await getVariantIdForMaterialCode(env.DB, "shop_1", "555")).toBeNull();
  });

  it("stops applying a mapping once it is deleted", async () => {
    // The whole reason this screen exists: a wrong pick was applied ahead of
    // every fuzzy match on every later import, and could not be taken back.
    await upsertMaterialCodeMap(env.DB, { id: "m1", shopId: "shop_1", materialCode: "122352", shopifyVariantId: V1, updatedAt: 100 });
    expect(await getVariantIdForMaterialCode(env.DB, "shop_1", "122352")).toBe(V1);

    const res = await app.request("/admin/api/material-codes/122352", { method: "DELETE", headers: await authHeaders() }, env);
    expect(res.status).toBe(200);
    expect(await getVariantIdForMaterialCode(env.DB, "shop_1", "122352")).toBeNull();
  });
});
