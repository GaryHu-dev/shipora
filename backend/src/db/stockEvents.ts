/**
 * Every change this app makes to Shopify stock, as one timeline.
 *
 * Two kinds share the table because they are the same event: a batch of lines,
 * each with a before and an after, written at one location at one moment.
 *   - `import` — a supplier delivery note; quantities are ADDED.
 *   - `count`  — one Save from the Stock tab; quantities are SET. One row per
 *                Save, whether the merchant confirmed one product or fifty.
 */
export type StockEventKind = "import" | "count";

export interface NewEventLine {
  id: string;
  /** Import only — the supplier's code. NULL on a count. */
  materialCode: string | null;
  /** The source's own wording — a delivery note's line text. */
  description: string;
  /** The Shopify product actually written to. Null when nothing matched. */
  productTitle: string | null;
  shopifyVariantId: string | null;
  /** Import only — units delivered. A count carries its change in before/after. */
  deliveredQty: number | null;
  qtyBefore: number | null;
  qtyAfter: number | null;
  /** Import only — the note's expiry date. Never written to Shopify. */
  sled: string | null;
  skipped: boolean;
  status: "ok" | "error" | "skipped";
  /** Why this line failed, in the merchant's words. */
  error: string | null;
}

export interface NewStockEvent {
  id: string;
  shopId: string;
  kind: StockEventKind;
  filename: string | null;
  pdfR2Key: string | null;
  locationId: string;
  createdAt: number;
  lines: NewEventLine[];
}

export async function createStockEvent(db: D1Database, e: NewStockEvent): Promise<void> {
  const statements = [
    db.prepare(
      "INSERT INTO stock_events (id, shop_id, kind, filename, pdf_r2_key, location_id, created_at) VALUES (?,?,?,?,?,?,?)"
    ).bind(e.id, e.shopId, e.kind, e.filename, e.pdfR2Key, e.locationId, e.createdAt),
    ...e.lines.map((l) =>
      db.prepare(
        `INSERT INTO stock_event_lines
         (id, event_id, material_code, description, product_title, shopify_variant_id, delivered_qty, qty_before, qty_after, sled, skipped, status, error)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        l.id, e.id, l.materialCode, l.description, l.productTitle, l.shopifyVariantId, l.deliveredQty,
        l.qtyBefore, l.qtyAfter, l.sled, l.skipped ? 1 : 0, l.status, l.error
      )
    ),
  ];
  await db.batch(statements);
}

export interface StockEventSummary {
  id: string;
  kind: StockEventKind;
  filename: string | null;
  created_at: number;
  line_count: number;
  ok_count: number;
  skipped_count: number;
  error_count: number;
  /** Net units added or removed across this event's successful lines. */
  net_change: number | null;
}

export async function listStockEvents(
  db: D1Database,
  shopId: string,
  opts: { limit?: number; offset?: number }
): Promise<StockEventSummary[]> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  const { results } = await db
    .prepare(
      `SELECT e.id, e.kind, e.filename, e.created_at,
              COUNT(l.id) AS line_count,
              SUM(CASE WHEN l.skipped = 0 AND l.status = 'ok' THEN 1 ELSE 0 END) AS ok_count,
              SUM(CASE WHEN l.skipped = 1 THEN 1 ELSE 0 END) AS skipped_count,
              SUM(CASE WHEN l.skipped = 0 AND l.status = 'error' THEN 1 ELSE 0 END) AS error_count,
              SUM(CASE WHEN l.skipped = 0 AND l.status = 'ok' AND l.qty_after IS NOT NULL AND l.qty_before IS NOT NULL
                       THEN l.qty_after - l.qty_before ELSE 0 END) AS net_change
       FROM stock_events e
       LEFT JOIN stock_event_lines l ON l.event_id = e.id
       WHERE e.shop_id = ?
       GROUP BY e.id
       ORDER BY e.created_at DESC
       LIMIT ? OFFSET ?`
    )
    .bind(shopId, limit, offset)
    .all<StockEventSummary>();
  return results;
}

export interface StockEventDetail {
  id: string;
  kind: StockEventKind;
  filename: string | null;
  pdf_r2_key: string | null;
  location_id: string;
  created_at: number;
}

export async function getStockEventForShop(
  db: D1Database,
  shopId: string,
  eventId: string
): Promise<StockEventDetail | null> {
  return await db
    .prepare("SELECT id, kind, filename, pdf_r2_key, location_id, created_at FROM stock_events WHERE id = ? AND shop_id = ?")
    .bind(eventId, shopId)
    .first<StockEventDetail>();
}

export interface StockEventLineRow {
  id: string;
  material_code: string | null;
  description: string;
  product_title: string | null;
  shopify_variant_id: string | null;
  delivered_qty: number | null;
  qty_before: number | null;
  qty_after: number | null;
  sled: string | null;
  skipped: number;
  status: string;
  error: string | null;
}

export async function listStockEventLines(db: D1Database, eventId: string): Promise<StockEventLineRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM stock_event_lines WHERE event_id = ?")
    .bind(eventId)
    .all<StockEventLineRow>();
  return results;
}
