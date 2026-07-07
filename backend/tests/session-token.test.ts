import { describe, it, expect } from "vitest";
import { verifyShopifySessionToken } from "../src/shopify/sessionToken";

const API_KEY = "test-api-key";
const SECRET = "test-api-secret";

function b64url(bytes: Uint8Array): string {
  let bin = ""; for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function mintToken(claims: Record<string, unknown>, secret = SECRET): Promise<string> {
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = b64url(new TextEncoder().encode(JSON.stringify(claims)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${header}.${payload}`)));
  return `${header}.${payload}.${b64url(sig)}`;
}
function claims(over: Record<string, unknown> = {}) {
  const now = 1_000_000;
  return { iss: "https://demo.myshopify.com/admin", dest: "https://demo.myshopify.com", aud: API_KEY, sub: "42", exp: now + 60, nbf: now - 60, iat: now, ...over };
}

describe("verifyShopifySessionToken", () => {
  it("accepts a valid token and returns the shop domain", async () => {
    const t = await mintToken(claims());
    expect(await verifyShopifySessionToken(t, API_KEY, SECRET, 1_000_000)).toEqual({ shopDomain: "demo.myshopify.com" });
  });
  it("rejects a bad signature", async () => {
    const t = await mintToken(claims(), "wrong-secret");
    expect(await verifyShopifySessionToken(t, API_KEY, SECRET, 1_000_000)).toBeNull();
  });
  it("rejects a wrong aud", async () => {
    const t = await mintToken(claims({ aud: "someone-else" }));
    expect(await verifyShopifySessionToken(t, API_KEY, SECRET, 1_000_000)).toBeNull();
  });
  it("rejects an expired token", async () => {
    const t = await mintToken(claims({ exp: 999_000 }));
    expect(await verifyShopifySessionToken(t, API_KEY, SECRET, 1_000_000)).toBeNull();
  });
  it("rejects a not-yet-valid token", async () => {
    const t = await mintToken(claims({ nbf: 1_000_500 }));
    expect(await verifyShopifySessionToken(t, API_KEY, SECRET, 1_000_000)).toBeNull();
  });
  it("rejects a malformed token", async () => {
    expect(await verifyShopifySessionToken("a.b", API_KEY, SECRET, 1_000_000)).toBeNull();
  });
});
