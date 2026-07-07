export interface Order {
  id: string;
  shop_id: string;
  shopify_order_id: string;
  order_number: string;
  customer_name: string | null;
  fulfillment_status: string;
  created_at: number;
  synced_at: number;
}

export async function upsertOrder(
  db: D1Database,
  o: {
    id: string; shopId: string; shopifyOrderId: string; orderNumber: string;
    customerName: string | null; fulfillmentStatus: string; createdAt: number; syncedAt: number;
  }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO orders (id, shop_id, shopify_order_id, order_number, customer_name, fulfillment_status, created_at, synced_at)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT (shop_id, shopify_order_id) DO UPDATE SET
         order_number = excluded.order_number,
         customer_name = excluded.customer_name,
         fulfillment_status = excluded.fulfillment_status,
         synced_at = excluded.synced_at`
    )
    .bind(o.id, o.shopId, o.shopifyOrderId, o.orderNumber, o.customerName, o.fulfillmentStatus, o.createdAt, o.syncedAt)
    .run();
}

export async function listOrders(
  db: D1Database,
  shopId: string,
  opts: { status?: "unfulfilled" | "fulfilled" | "all"; q?: string; limit?: number; offset?: number }
): Promise<Order[]> {
  const status = opts.status ?? "unfulfilled";
  const clauses = ["shop_id = ?"];
  const binds: unknown[] = [shopId];

  if (status !== "all") {
    clauses.push("fulfillment_status = ?");
    binds.push(status);
  }
  if (opts.q) {
    clauses.push("(LOWER(order_number) LIKE ? OR LOWER(COALESCE(customer_name,'')) LIKE ?)");
    const like = `%${opts.q.toLowerCase()}%`;
    binds.push(like, like);
  }

  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  const sql = `SELECT * FROM orders WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  const { results } = await db.prepare(sql).bind(...binds, limit, offset).all<Order>();
  return results;
}

export async function getOrderByIdForShop(
  db: D1Database,
  shopId: string,
  orderId: string
): Promise<Order | null> {
  return await db
    .prepare("SELECT * FROM orders WHERE id = ? AND shop_id = ?")
    .bind(orderId, shopId)
    .first<Order>();
}

export async function getOrderByShopifyId(
  db: D1Database,
  shopId: string,
  shopifyOrderId: string
): Promise<Order | null> {
  return await db
    .prepare("SELECT * FROM orders WHERE shop_id = ? AND shopify_order_id = ?")
    .bind(shopId, shopifyOrderId)
    .first<Order>();
}
