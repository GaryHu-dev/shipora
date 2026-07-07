function b64urlToBytes(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

interface SessionClaims {
  dest?: string;
  aud?: string;
  exp?: number;
  nbf?: number;
}

export async function verifyShopifySessionToken(
  token: string,
  apiKey: string,
  secret: string,
  nowSeconds: number
): Promise<{ shopDomain: string } | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;

  // Reject anything but HS256 (defense against alg-confusion).
  try {
    const h = JSON.parse(new TextDecoder().decode(b64urlToBytes(header)));
    if (h.alg !== "HS256") return null;
  } catch { return null; }

  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${header}.${payload}`)));
  let provided: Uint8Array;
  try { provided = b64urlToBytes(sig); } catch { return null; }
  if (!timingSafeEqual(expected, provided)) return null;

  let claims: SessionClaims;
  try { claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(payload))); } catch { return null; }

  if (claims.aud !== apiKey) return null;
  if (typeof claims.exp !== "number" || claims.exp <= nowSeconds) return null;
  if (typeof claims.nbf !== "number" || claims.nbf > nowSeconds) return null;
  if (typeof claims.dest !== "string") return null;

  let shopDomain: string;
  try { shopDomain = new URL(claims.dest).hostname; } catch { return null; }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shopDomain)) return null;

  return { shopDomain };
}
