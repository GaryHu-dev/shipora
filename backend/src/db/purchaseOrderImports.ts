export interface NewImportLine {
  id: string;
  materialCode: string;
  description: string;
  shopifyVariantId: string | null;
  deliveredQty: number;
  qtyBefore: number | null;
  qtyAfter: number | null;
  sled: string | null;
  expiryUpdated: boolean;
  skipped: boolean;
  status: "ok" | "error";
}

export async function createImport(
  db: D1Database,
  i: {
    id: string; shopId: string; filename: string; pdfR2Key: string;
    locationId: string; importedAt: number; lines: NewImportLine[];
  }
): Promise<void> {
  const statements = [
    db.prepare(
      "INSERT INTO purchase_order_imports (id, shop_id, filename, pdf_r2_key, location_id, imported_at) VALUES (?,?,?,?,?,?)"
    ).bind(i.id, i.shopId, i.filename, i.pdfR2Key, i.locationId, i.importedAt),
    ...i.lines.map((l) =>
      db.prepare(
        `INSERT INTO purchase_order_import_lines
         (id, import_id, material_code, description, shopify_variant_id, delivered_qty, qty_before, qty_after, sled, expiry_updated, skipped, status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        l.id, i.id, l.materialCode, l.description, l.shopifyVariantId, l.deliveredQty,
        l.qtyBefore, l.qtyAfter, l.sled, l.expiryUpdated ? 1 : 0, l.skipped ? 1 : 0, l.status
      )
    ),
  ];
  await db.batch(statements);
}

export interface ImportSummary {
  id: string;
  filename: string;
  imported_at: number;
  line_count: number;
  ok_count: number;
  skipped_count: number;
  error_count: number;
}

export async function listImports(
  db: D1Database,
  shopId: string,
  opts: { limit?: number; offset?: number }
): Promise<ImportSummary[]> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  const { results } = await db
    .prepare(
      `SELECT i.id, i.filename, i.imported_at,
              COUNT(l.id) AS line_count,
              SUM(CASE WHEN l.skipped = 0 AND l.status = 'ok' THEN 1 ELSE 0 END) AS ok_count,
              SUM(CASE WHEN l.skipped = 1 THEN 1 ELSE 0 END) AS skipped_count,
              SUM(CASE WHEN l.skipped = 0 AND l.status = 'error' THEN 1 ELSE 0 END) AS error_count
       FROM purchase_order_imports i
       LEFT JOIN purchase_order_import_lines l ON l.import_id = i.id
       WHERE i.shop_id = ?
       GROUP BY i.id
       ORDER BY i.imported_at DESC
       LIMIT ? OFFSET ?`
    )
    .bind(shopId, limit, offset)
    .all<ImportSummary>();
  return results;
}

export interface ImportDetail {
  id: string;
  filename: string;
  pdf_r2_key: string;
  location_id: string;
  imported_at: number;
}

export async function getImportByIdForShop(
  db: D1Database,
  shopId: string,
  importId: string
): Promise<ImportDetail | null> {
  return await db
    .prepare("SELECT id, filename, pdf_r2_key, location_id, imported_at FROM purchase_order_imports WHERE id = ? AND shop_id = ?")
    .bind(importId, shopId)
    .first<ImportDetail>();
}

export interface ImportLineRow {
  id: string;
  material_code: string;
  description: string;
  shopify_variant_id: string | null;
  delivered_qty: number;
  qty_before: number | null;
  qty_after: number | null;
  sled: string | null;
  expiry_updated: number;
  skipped: number;
  status: string;
}

export async function listImportLines(db: D1Database, importId: string): Promise<ImportLineRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM purchase_order_import_lines WHERE import_id = ?")
    .bind(importId)
    .all<ImportLineRow>();
  return results;
}
