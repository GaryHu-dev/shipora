import { Hono } from "hono";
import type { Env } from "../types";
import { requireSession, type AppVars } from "../auth/session";
import { getOrderByIdForShop } from "../db/orders";
import { createPhoto, listPhotosByOrder, getPhotoByIdForShop } from "../db/photos";
import { getShopById } from "../db/shops";
import { addOrderTag } from "../shopify/tags";
import { putPhoto, getPhoto } from "../r2";
import { newId } from "../ids";

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

  const photoId = newId("photo");
  const r2Key = `${shopId}/${orderId}/${photoId}.jpg`;
  await putPhoto(c.env.PHOTOS, r2Key, await photo.arrayBuffer(), photo.type || "image/jpeg");

  let thumbKey: string | null = null;
  if (thumb instanceof File) {
    thumbKey = `${shopId}/${orderId}/${photoId}_t.jpg`;
    await putPhoto(c.env.PHOTOS, thumbKey, await thumb.arrayBuffer(), thumb.type || "image/jpeg");
  }

  const now = Math.floor(Date.now() / 1000);
  await createPhoto(c.env.DB, {
    id: photoId, shopId, orderId, uploadedBy: c.get("userId"),
    r2Key, thumbKey, note, uploadedAt: now,
  });

  // Best-effort Shopify timeline marker: tag the order. Never fail the upload on this.
  try {
    const shop = await getShopById(c.env.DB, shopId);
    if (shop && shop.access_token) {
      await addOrderTag(shop.shop_domain, shop.access_token, order.shopify_order_id, "发货照片已上传");
    }
  } catch (err) {
    console.error("tag write-back failed", { orderId, err: String(err) });
  }

  return c.json({ photo: { id: photoId, r2_key: r2Key, thumb_key: thumbKey, uploaded_at: now } });
});

photoRoutes.get("/orders/:orderId/photos", requireSession(), async (c) => {
  const photos = await listPhotosByOrder(c.env.DB, c.get("shopId"), c.req.param("orderId"));
  return c.json({ photos });
});

photoRoutes.get("/photos/:photoId/raw", requireSession(), async (c) => {
  const row = await getPhotoByIdForShop(c.env.DB, c.get("shopId"), c.req.param("photoId"));
  if (!row) return c.json({ error: "not found" }, 404);
  const obj = await getPhoto(c.env.PHOTOS, row.r2_key);
  if (!obj) return c.json({ error: "not found" }, 404);
  return new Response(obj.body, {
    headers: { "content-type": obj.httpMetadata?.contentType ?? "image/jpeg" },
  });
});
