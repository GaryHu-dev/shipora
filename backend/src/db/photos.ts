export interface Photo {
  id: string;
  shop_id: string;
  order_id: string;
  uploaded_by: string;
  r2_key: string;
  thumb_key: string | null;
  note: string | null;
  uploaded_at: number;
  category: string;
  content_type: string | null;
}

export async function createPhoto(
  db: D1Database,
  p: {
    id: string; shopId: string; orderId: string; uploadedBy: string;
    r2Key: string; thumbKey: string | null; note: string | null; uploadedAt: number;
    category?: string; contentType?: string | null;
  }
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO shipment_photos (id, shop_id, order_id, uploaded_by, r2_key, thumb_key, note, uploaded_at, category, content_type) VALUES (?,?,?,?,?,?,?,?,?,?)"
    )
    .bind(p.id, p.shopId, p.orderId, p.uploadedBy, p.r2Key, p.thumbKey, p.note, p.uploadedAt, p.category ?? "shipping_photo", p.contentType ?? null)
    .run();
}

export interface TimelineEntry {
  id: string;
  category: string;
  content_type: string | null;
  note: string | null;
  uploaded_at: number;
  uploaded_by_name: string;
}

export async function listOrderTimeline(db: D1Database, shopId: string, orderId: string): Promise<TimelineEntry[]> {
  const { results } = await db
    .prepare(
      `SELECT p.id, p.category, p.content_type, p.note, p.uploaded_at,
              COALESCE(u.name, 'Unknown') AS uploaded_by_name
       FROM shipment_photos p LEFT JOIN users u ON u.id = p.uploaded_by
       WHERE p.shop_id = ? AND p.order_id = ? ORDER BY p.uploaded_at DESC`
    )
    .bind(shopId, orderId)
    .all<TimelineEntry>();
  return results;
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

export async function getPhotoById(db: D1Database, photoId: string): Promise<Photo | null> {
  return await db.prepare("SELECT * FROM shipment_photos WHERE id = ?").bind(photoId).first<Photo>();
}

export interface RecentPhoto {
  id: string;
  order_id: string;
  order_number: string;
  uploaded_at: number;
  category: string;
  content_type: string | null;
}

export async function listRecentPhotos(db: D1Database, shopId: string, limit: number, q?: string): Promise<RecentPhoto[]> {
  const clauses = ["p.shop_id = ?"];
  const binds: unknown[] = [shopId];
  if (q) {
    clauses.push("LOWER(o.order_number) LIKE ?");
    binds.push(`%${q.toLowerCase()}%`);
  }
  const { results } = await db
    .prepare(
      `SELECT p.id, p.order_id, o.order_number, p.uploaded_at, p.category, p.content_type
       FROM shipment_photos p JOIN orders o ON o.id = p.order_id
       WHERE ${clauses.join(" AND ")} ORDER BY p.uploaded_at DESC LIMIT ?`
    )
    .bind(...binds, limit)
    .all<RecentPhoto>();
  return results;
}
