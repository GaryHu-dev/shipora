function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return new Uint8Array(sig);
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function signToken(
  payload: Record<string, unknown>,
  secret: string,
  ttlSeconds: number,
  nowSeconds: number
): Promise<string> {
  const body = { ...payload, exp: nowSeconds + ttlSeconds };
  const encoded = b64urlEncode(new TextEncoder().encode(JSON.stringify(body)));
  const sig = b64urlEncode(await hmac(secret, encoded));
  return `${encoded}.${sig}`;
}

export async function verifyToken(
  token: string,
  secret: string,
  nowSeconds: number
): Promise<Record<string, unknown> | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expected = await hmac(secret, encoded);
  let provided: Uint8Array;
  try {
    provided = b64urlDecode(sig);
  } catch {
    return null;
  }
  if (!timingSafeEqual(expected, provided)) return null;
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(new TextDecoder().decode(b64urlDecode(encoded)));
  } catch {
    return null;
  }
  if (typeof body.exp !== "number" || body.exp < nowSeconds) return null;
  return body;
}
