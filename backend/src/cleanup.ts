import type { Env } from "./types";

// Delete a shop's shipment photos older than `retentionDays` (both the R2
// objects and the D1 rows). Returns how many photos were removed.
export async function deleteExpiredPhotos(
  env: Env,
  shopId: string,
  retentionDays: number,
  nowSeconds: number
): Promise<number> {
  const cutoff = nowSeconds - retentionDays * 24 * 60 * 60;
  const { results } = await env.DB
    .prepare("SELECT id, r2_key, thumb_key FROM shipment_photos WHERE shop_id = ? AND uploaded_at < ?")
    .bind(shopId, cutoff)
    .all<{ id: string; r2_key: string; thumb_key: string | null }>();

  for (const p of results) {
    await env.PHOTOS.delete(p.r2_key);
    if (p.thumb_key) await env.PHOTOS.delete(p.thumb_key);
    await env.DB.prepare("DELETE FROM shipment_photos WHERE id = ?").bind(p.id).run();
  }
  return results.length;
}
