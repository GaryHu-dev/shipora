export interface MaterialCodeMapping {
  materialCode: string;
  shopifyVariantId: string;
  updatedAt: number;
}

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

export async function listMaterialCodeMaps(
  db: D1Database,
  shopId: string
): Promise<MaterialCodeMapping[]> {
  const { results } = await db
    .prepare(
      `SELECT material_code, shopify_variant_id, updated_at
       FROM material_code_map WHERE shop_id = ? ORDER BY material_code`
    )
    .bind(shopId)
    .all<{ material_code: string; shopify_variant_id: string; updated_at: number }>();

  return results.map((r) => ({
    materialCode: r.material_code,
    shopifyVariantId: r.shopify_variant_id,
    updatedAt: r.updated_at,
  }));
}

export async function deleteMaterialCodeMap(
  db: D1Database,
  shopId: string,
  materialCode: string
): Promise<void> {
  await db
    .prepare("DELETE FROM material_code_map WHERE shop_id = ? AND material_code = ?")
    .bind(shopId, materialCode)
    .run();
}
