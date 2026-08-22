import { Hono } from "hono";
import type { Env } from "../types";
import { requireAdminSession, type AdminVars } from "../auth/adminSession";
import { makeJoinToken } from "./join";
import { qrDataUrl } from "../shopify/qr";
import { listOrders, getOrderByShopifyId } from "../db/orders";
import { listOrderTimeline, getPhotoByIdForShop, listRecentPhotos } from "../db/photos";
import { getShopById, setRetentionDays, setJoinSecret } from "../db/shops";
import { deleteExpiredPhotos } from "../cleanup";
import { checkSyncHealth } from "../shopify/syncHealth";
import { syncRecentOrders } from "../shopify/ordersSync";
import { registerWebhooks } from "../shopify/webhooks";
import { newId } from "../ids";
import { getPhoto } from "../r2";

export const adminRoutes = new Hono<{ Bindings: Env; Variables: AdminVars }>();

adminRoutes.post("/admin/api/join-qr", requireAdminSession(), async (c) => {
  const now = Math.floor(Date.now() / 1000);
  const shop = await getShopById(c.env.DB, c.get("shopId"));
  if (!shop) return c.json({ error: "shop not found" }, 404);
  const joinToken = await makeJoinToken(c.env.APP_SECRET, shop.join_secret, shop.id, now);
  const joinUrl = `${c.env.PWA_URL}/#/join?token=${joinToken}`;
  return c.json({ joinUrl, qrDataUrl: qrDataUrl(joinUrl) });
});

// Rotate the shop's join code — invalidates all previously issued QR links.
adminRoutes.post("/admin/api/reset-join-code", requireAdminSession(), async (c) => {
  await setJoinSecret(c.env.DB, c.get("shopId"), newId("jsec"));
  return c.json({ ok: true });
});

adminRoutes.get("/admin/api/orders", requireAdminSession(), async (c) => {
  const raw = c.req.query("status");
  const status = raw === "fulfilled" || raw === "all" ? raw : "unfulfilled";
  const q = c.req.query("q") || undefined;
  const orders = await listOrders(c.env.DB, c.get("shopId"), { status, q });
  return c.json({ orders });
});

adminRoutes.get("/admin/api/orders/:id/photos", requireAdminSession(), async (c) => {
  const photos = await listOrderTimeline(c.env.DB, c.get("shopId"), c.req.param("id"));
  return c.json({ photos });
});

adminRoutes.get("/admin/api/recent-photos", requireAdminSession(), async (c) => {
  const q = c.req.query("q")?.trim() || undefined;
  const photos = await listRecentPhotos(c.env.DB, c.get("shopId"), 10, q);
  return c.json({ photos });
});

// Photos for a Shopify order GID (used by the admin order-page block extension),
// each with a short-lived signed view URL that opens without an auth header.
adminRoutes.get("/admin/api/order-photos", requireAdminSession(), async (c) => {
  const gid = c.req.query("gid") ?? "";
  const order = await getOrderByShopifyId(c.env.DB, c.get("shopId"), gid);
  if (!order) return c.json({ photos: [] });
  const timeline = await listOrderTimeline(c.env.DB, c.get("shopId"), order.id);
  const photos = timeline.map((p) => ({ ...p, url: `${c.env.APP_URL}/p/${p.id}` }));
  return c.json({ photos });
});

adminRoutes.get("/admin/api/settings", requireAdminSession(), async (c) => {
  const shop = await getShopById(c.env.DB, c.get("shopId"));
  return c.json({ retentionDays: shop?.retention_days ?? 30 });
});

adminRoutes.post("/admin/api/settings", requireAdminSession(), async (c) => {
  const body = (await c.req.json().catch(() => null)) as { retentionDays?: unknown } | null;
  const days = Number(body?.retentionDays);
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    return c.json({ error: "retentionDays must be an integer between 1 and 365" }, 400);
  }
  await setRetentionDays(c.env.DB, c.get("shopId"), days);
  return c.json({ retentionDays: days });
});

adminRoutes.post("/admin/api/cleanup", requireAdminSession(), async (c) => {
  const shop = await getShopById(c.env.DB, c.get("shopId"));
  const days = shop?.retention_days ?? 30;
  const deleted = await deleteExpiredPhotos(c.env, c.get("shopId"), days, Math.floor(Date.now() / 1000));
  return c.json({ deleted });
});

adminRoutes.get("/admin/api/photos/:id/raw", requireAdminSession(), async (c) => {
  const row = await getPhotoByIdForShop(c.env.DB, c.get("shopId"), c.req.param("id"));
  if (!row) return c.json({ error: "not found" }, 404);
  const obj = await getPhoto(c.env.PHOTOS, row.r2_key);
  if (!obj) return c.json({ error: "not found" }, 404);
  return new Response(obj.body, {
    headers: {
      "content-type": obj.httpMetadata?.contentType ?? "image/jpeg",
      "x-content-type-options": "nosniff",
      "content-disposition": "inline",
    },
  });
});

// Is order sync actually working? Answered against Shopify rather than against
// the clock — see syncHealth.ts for why "time since the last order" cannot
// tell a quiet shop from a broken webhook.
adminRoutes.get("/admin/api/sync-health", requireAdminSession(), async (c) => {
  const shop = await getShopById(c.env.DB, c.get("shopId"));
  if (!shop) return c.json({ error: "shop not found" }, 404);
  try {
    return c.json(await checkSyncHealth(c.env.DB, shop));
  } catch {
    // A failed check is not a failed sync. Say so rather than showing an
    // alarm the merchant cannot act on.
    return c.json({ unavailable: true });
  }
});

// The remedy for the warning above. Without it the banner would only be able
// to tell someone their orders are missing.
adminRoutes.post("/admin/api/sync-health/resync", requireAdminSession(), async (c) => {
  const shop = await getShopById(c.env.DB, c.get("shopId"));
  if (!shop) return c.json({ error: "shop not found" }, 404);
  // Backfilling the missing orders treats the symptom. The cause is almost
  // always a subscription pointing at a deployment that no longer answers —
  // which is what happened on the account move — so repair that in the same
  // click, or the same orders go missing again tomorrow.
  const hooks = await registerWebhooks(c.env, shop);
  const synced = await syncRecentOrders(c.env.DB, shop, Math.floor(Date.now() / 1000));
  return c.json({ synced, repointed: hooks.repointed, health: await checkSyncHealth(c.env.DB, shop) });
});
