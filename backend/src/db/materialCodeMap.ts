export async function getVariantIdForMaterialCode(
  db: D1Database,
  shopId: string,
  materialCode: string
): Promise<string | null> {
  const row = await db
    .prepare("SELECT shopify_variant_id FROM material_code_map WHERE shop_id = ? AND material_code = ?")
    .bind(shopId, materialCode)
    .first<{ shopify_variant_id: string }>();
  return row?.shopify_variant_id ?? null;
}

export async function upsertMaterialCodeMap(
  db: D1Database,
  m: { id: string; shopId: string; materialCode: string; shopifyVariantId: string; updatedAt: number }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO material_code_map (id, shop_id, material_code, shopify_variant_id, updated_at)
       VALUES (?,?,?,?,?)
       ON CONFLICT (shop_id, material_code) DO UPDATE SET
         shopify_variant_id = excluded.shopify_variant_id,
         updated_at = excluded.updated_at`
    )
    .bind(m.id, m.shopId, m.materialCode, m.shopifyVariantId, m.updatedAt)
    .run();
}
