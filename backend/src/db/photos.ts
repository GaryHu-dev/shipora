export interface Photo {
  id: string;
  shop_id: string;
  order_id: string;
  uploaded_by: string;
  r2_key: string;
  thumb_key: string | null;
  note: string | null;
  uploaded_at: number;
}

export async function createPhoto(
  db: D1Database,
  p: {
    id: string; shopId: string; orderId: string; uploadedBy: string;
    r2Key: string; thumbKey: string | null; note: string | null; uploadedAt: number;
  }
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO shipment_photos (id, shop_id, order_id, uploaded_by, r2_key, thumb_key, note, uploaded_at) VALUES (?,?,?,?,?,?,?,?)"
    )
    .bind(p.id, p.shopId, p.orderId, p.uploadedBy, p.r2Key, p.thumbKey, p.note, p.uploadedAt)
    .run();
}

export async function listPhotosByOrder(db: D1Database, shopId: string, orderId: string): Promise<Photo[]> {
  const { results } = await db
    .prepare("SELECT * FROM shipment_photos WHERE shop_id = ? AND order_id = ? ORDER BY uploaded_at ASC")
    .bind(shopId, orderId)
    .all<Photo>();
  return results;
}

export async function getPhotoByIdForShop(
  db: D1Database,
  shopId: string,
  photoId: string
): Promise<Photo | null> {
  return await db
    .prepare("SELECT * FROM shipment_photos WHERE id = ? AND shop_id = ?")
    .bind(photoId, shopId)
    .first<Photo>();
}
