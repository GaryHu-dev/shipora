import { describe, it, expect } from "vitest";
import { verifyOAuthHmac, verifyWebhookHmac } from "../src/shopify/hmac";

const SECRET = "hush";

async function hex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function b64(secret: string, bytes: ArrayBuffer): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, bytes);
  let bin = ""; for (const x of new Uint8Array(sig)) bin += String.fromCharCode(x);
  return btoa(bin);
}

describe("verifyOAuthHmac", () => {
  it("accepts a correctly signed query", async () => {
    const msg = "code=abc&shop=x.myshopify.com&state=n1&timestamp=123";
    const good = await hex(SECRET, msg);
    const params = new URLSearchParams(`${msg}&hmac=${good}`);
    expect(await verifyOAuthHmac(params, SECRET)).toBe(true);
  });

  it("rejects a bad hmac", async () => {
    const params = new URLSearchParams("code=abc&shop=x.myshopify.com&state=n1&timestamp=123&hmac=deadbeef");
    expect(await verifyOAuthHmac(params, SECRET)).toBe(false);
  });
});

describe("verifyWebhookHmac", () => {
  it("accepts a correctly signed body", async () => {
    const body = new TextEncoder().encode('{"id":1}').buffer as ArrayBuffer;
    const header = await b64(SECRET, body);
    expect(await verifyWebhookHmac(body, header, SECRET)).toBe(true);
  });

  it("rejects a bad signature", async () => {
    const body = new TextEncoder().encode('{"id":1}').buffer as ArrayBuffer;
    expect(await verifyWebhookHmac(body, "bm90LXZhbGlk", SECRET)).toBe(false);
  });
});
