export interface TrackedProduct {
  shopifyVariantId: string;
  shopifyProductId: string;
  addedAt: number;
  lastCountedAt: number | null;
  lastBbdCheckedAt: number | null;
}

interface Row {
  shopify_variant_id: string;
  shopify_product_id: string;
  added_at: number;
  last_counted_at: number | null;
  last_bbd_checked_at: number | null;
}

export async function listTrackedProducts(db: D1Database, shopId: string): Promise<TrackedProduct[]> {
  const { results } = await db
    .prepare(
      `SELECT shopify_variant_id, shopify_product_id, added_at, last_counted_at, last_bbd_checked_at
       FROM tracked_products WHERE shop_id = ? ORDER BY added_at DESC`
    )
    .bind(shopId)
    .all<Row>();

  return results.map((r) => ({
    shopifyVariantId: r.shopify_variant_id,
    shopifyProductId: r.shopify_product_id,
    addedAt: r.added_at,
    lastCountedAt: r.last_counted_at,
    lastBbdCheckedAt: r.last_bbd_checked_at,
  }));
}

export async function addTrackedProduct(
  db: D1Database,
  t: { id: string; shopId: string; shopifyVariantId: string; shopifyProductId: string; addedAt: number }
): Promise<void> {
  // DO NOTHING, not DO UPDATE: import confirm calls this for every matched line
  // on every import, and an update would reset added_at and — worse — could
  // clear the count progress the merchant built up this week.
  await db
    .prepare(
      `INSERT INTO tracked_products (id, shop_id, shopify_variant_id, shopify_product_id, added_at)
       VALUES (?,?,?,?,?)
       ON CONFLICT (shop_id, shopify_variant_id) DO NOTHING`
    )
    .bind(t.id, t.shopId, t.shopifyVariantId, t.shopifyProductId, t.addedAt)
    .run();
}

export async function removeTrackedProduct(
  db: D1Database,
  shopId: string,
  shopifyVariantId: string
): Promise<void> {
  await db
    .prepare("DELETE FROM tracked_products WHERE shop_id = ? AND shopify_variant_id = ?")
    .bind(shopId, shopifyVariantId)
    .run();
}

export async function markCounted(
  db: D1Database,
  shopId: string,
  shopifyVariantId: string,
  at: number
): Promise<void> {
  await db
    .prepare("UPDATE tracked_products SET last_counted_at = ? WHERE shop_id = ? AND shopify_variant_id = ?")
    .bind(at, shopId, shopifyVariantId)
    .run();
}
