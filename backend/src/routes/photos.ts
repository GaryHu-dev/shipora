import { Hono } from "hono";
import type { Env } from "../types";
import { requireSession, type AppVars } from "../auth/session";
import { getOrderByIdForShop } from "../db/orders";
import { createPhoto, listOrderTimeline, getPhotoByIdForShop } from "../db/photos";
import { getShopById } from "../db/shops";
import { getUserById } from "../db/users";
import { addOrderTag } from "../shopify/tags";
import { appendOrderNote, removeOrderNoteLine } from "../shopify/notes";
import { putPhoto, getPhoto } from "../r2";
import { newId } from "../ids";
import { normalizeCategory, CATEGORY_LABELS } from "../categories";

export const photoRoutes = new Hono<{ Bindings: Env; Variables: AppVars }>();

photoRoutes.post("/orders/:orderId/photos", requireSession(), async (c) => {
  const shopId = c.get("shopId");
  const orderId = c.req.param("orderId");
  const order = await getOrderByIdForShop(c.env.DB, shopId, orderId);
  if (!order) return c.json({ error: "order not found" }, 404);

  const fd = await c.req.formData();
  const photo: unknown = fd.get("photo");
  if (!(photo instanceof File)) return c.json({ error: "photo file required" }, 400);
  const thumb: unknown = fd.get("thumb");
  const note = typeof fd.get("note") === "string" ? (fd.get("note") as string) : null;
  const category = normalizeCategory(fd.get("category"));

  // Only accept raster images (an SVG/HTML "image" served back from /p/:id would
  // execute as script on this origin) and cap the size to avoid memory exhaustion.
  const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
  const MAX_BYTES = 12 * 1024 * 1024;
  const contentType = photo.type || "image/jpeg";
  if (!ALLOWED_TYPES.includes(contentType)) return c.json({ error: "unsupported image type" }, 400);
  if (photo.size > MAX_BYTES) return c.json({ error: "image too large" }, 413);

  const photoId = newId("photo");
  const r2Key = `${shopId}/${orderId}/${photoId}.jpg`;
  await putPhoto(c.env.PHOTOS, r2Key, await photo.arrayBuffer(), contentType);

  let thumbKey: string | null = null;
  if (thumb instanceof File && ALLOWED_TYPES.includes(thumb.type || "image/jpeg") && thumb.size <= MAX_BYTES) {
    thumbKey = `${shopId}/${orderId}/${photoId}_t.jpg`;
    await putPhoto(c.env.PHOTOS, thumbKey, await thumb.arrayBuffer(), thumb.type || "image/jpeg");
  }

  const now = Math.floor(Date.now() / 1000);
  await createPhoto(c.env.DB, {
    id: photoId, shopId, orderId, uploadedBy: c.get("userId"),
    r2Key, thumbKey, note, uploadedAt: now, category, contentType,
  });

  // Best-effort Shopify write-backs (never fail the upload on these):
  //  - a tag (for filtering)
  //  - an appended order note (creates a visible Timeline entry)
  const shop = await getShopById(c.env.DB, shopId);
  if (shop && shop.access_token) {
    try {
      await addOrderTag(shop.shop_domain, shop.access_token, order.shopify_order_id, "Shipping photos uploaded");
    } catch (err) {
      console.error("tag write-back failed", { orderId, err: String(err) });
    }
    try {
      const user = await getUserById(c.env.DB, c.get("userId"));
      const label = CATEGORY_LABELS[category] ?? "Shipping photo";
      await appendOrderNote(shop.shop_domain, shop.access_token, order.shopify_order_id, `${label} uploaded by ${user?.name ?? "staff"}`);
    } catch (err) {
      console.error("note write-back failed", { orderId, err: String(err) });
    }
  }

  return c.json({ photo: { id: photoId, r2_key: r2Key, thumb_key: thumbKey, uploaded_at: now } });
});

photoRoutes.get("/orders/:orderId/photos", requireSession(), async (c) => {
  const photos = await listOrderTimeline(c.env.DB, c.get("shopId"), c.req.param("orderId"));
  return c.json({ photos });
});

photoRoutes.delete("/photos/:photoId", requireSession(), async (c) => {
  const shopId = c.get("shopId");
  const row = await getPhotoByIdForShop(c.env.DB, shopId, c.req.param("photoId"));
  if (!row) return c.json({ error: "not found" }, 404);
  await c.env.PHOTOS.delete(row.r2_key);
  if (row.thumb_key) await c.env.PHOTOS.delete(row.thumb_key);
  await c.env.DB.prepare("DELETE FROM shipment_photos WHERE id = ?").bind(row.id).run();

  // Keep the Shopify order note in sync — drop one matching upload line.
  try {
    const shop = await getShopById(c.env.DB, shopId);
    const order = await getOrderByIdForShop(c.env.DB, shopId, row.order_id);
    if (shop?.access_token && order) {
      const user = await getUserById(c.env.DB, row.uploaded_by);
      const label = CATEGORY_LABELS[row.category] ?? "Shipping photo";
      const line = `${label} uploaded by ${user?.name ?? "staff"}`;
      await removeOrderNoteLine(shop.shop_domain, shop.access_token, order.shopify_order_id, line);
    }
  } catch (err) {
    console.error("note cleanup on delete failed", { photoId: row.id, err: String(err) });
  }

  return c.json({ ok: true });
});

photoRoutes.get("/photos/:photoId/raw", requireSession(), async (c) => {
  const row = await getPhotoByIdForShop(c.env.DB, c.get("shopId"), c.req.param("photoId"));
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
