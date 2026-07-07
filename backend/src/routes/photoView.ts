import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "../types";
import { verifyToken } from "../auth/tokens";
import { getPhotoById } from "../db/photos";
import { getPhoto } from "../r2";

// Public, signed-URL / unguessable photo viewers. Protected against brute-force
// with per-IP rate limiting (A) and edge-cached for valid photos (B).
export const photoViewRoutes = new Hono<{ Bindings: Env }>();

// A — per-IP rate limit. Returns a 429 response if over the limit, else null.
async function rateLimited(c: Context<{ Bindings: Env }>): Promise<Response | null> {
  const rl = c.env.PHOTO_RL;
  if (!rl) return null;
  const ip = c.req.header("cf-connecting-ip") ?? "anon";
  const { success } = await rl.limit({ key: ip });
  return success ? null : c.text("Too many requests", 429);
}

// B — serve a photo, using the edge cache to skip repeat D1/R2 reads.
async function servePhoto(c: Context<{ Bindings: Env }>, photoId: string): Promise<Response> {
  const cache = caches.default;
  const cached = await cache.match(c.req.raw);
  if (cached) return cached;

  const row = await getPhotoById(c.env.DB, photoId);
  if (!row) return c.text("not found", 404);
  const obj = await getPhoto(c.env.PHOTOS, row.r2_key);
  if (!obj) return c.text("not found", 404);

  const res = new Response(obj.body, {
    headers: {
      "content-type": obj.httpMetadata?.contentType ?? "image/jpeg",
      "cache-control": "public, max-age=86400",
      "x-content-type-options": "nosniff",
      "content-disposition": "inline",
    },
  });
  try { c.executionCtx.waitUntil(cache.put(c.req.raw, res.clone())); } catch { /* no ctx in tests */ }
  return res;
}

// Short unguessable viewer (used in Shopify order notes and the order-page block).
photoViewRoutes.get("/p/:id", async (c) => {
  const limited = await rateLimited(c);
  if (limited) return limited;
  return servePhoto(c, c.req.param("id"));
});

// Signed viewer (legacy links) — token must match the photo id and be unexpired.
photoViewRoutes.get("/photos/:id/view", async (c) => {
  const limited = await rateLimited(c);
  if (limited) return limited;
  const id = c.req.param("id");
  const now = Math.floor(Date.now() / 1000);
  const payload = await verifyToken(c.req.query("t") ?? "", c.env.APP_SECRET, now);
  if (!payload || payload.kind !== "view" || payload.photo !== id) return c.text("Unauthorized", 401);
  return servePhoto(c, id);
});
