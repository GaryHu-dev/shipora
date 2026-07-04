async function sign(secret: string, data: ArrayBuffer): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyOAuthHmac(params: URLSearchParams, secret: string): Promise<boolean> {
  const received = params.get("hmac");
  if (!received) return false;
  const pairs: string[] = [];
  for (const [k, v] of params) {
    if (k === "hmac" || k === "signature") continue;
    pairs.push(`${k}=${v}`);
  }
  pairs.sort();
  const message = pairs.join("&");
  const expected = toHex(await sign(secret, new TextEncoder().encode(message).buffer as ArrayBuffer));
  return timingSafeEqual(new TextEncoder().encode(expected), new TextEncoder().encode(received));
}

export async function verifyWebhookHmac(rawBody: ArrayBuffer, headerB64: string, secret: string): Promise<boolean> {
  if (!headerB64) return false;
  const digest = await sign(secret, rawBody);
  let bin = ""; for (const b of digest) bin += String.fromCharCode(b);
  const expected = btoa(bin);
  return timingSafeEqual(new TextEncoder().encode(expected), new TextEncoder().encode(headerB64));
}
