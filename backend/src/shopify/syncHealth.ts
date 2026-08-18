import { shopifyGraphQL } from "./graphql";

// Whether order sync is actually working, answered by comparing what Shopify
// has against what we hold.
//
// The obvious metric — "how long since the last order arrived" — cannot answer
// it. A quiet weekend and a webhook pointing at a decommissioned Worker look
// identical from inside the database, which is why the real outage went five
// days without anyone noticing: the shop simply looked quiet.
//
// Comparing against Shopify does not have that ambiguity. If Shopify has
// orders we do not, sync is broken, however busy or quiet the shop is.

const RECENT_IDS_QUERY = `
query RecentOrderIds($first: Int!) {
  orders(first: $first, sortKey: CREATED_AT, reverse: true) {
    edges { node { id name createdAt } }
  }
}`;

interface RecentIdsResult {
  orders: { edges: { node: { id: string; name: string; createdAt: string } }[] };
}

export interface SyncHealth {
  /** How many of Shopify's most recent orders are absent from our database. */
  missing: number;
  /** The newest order Shopify has, whether or not we hold it. */
  shopifyNewest: string | null;
  /** The newest order we hold. */
  ourNewest: string | null;
  /** When we last recorded anything, Unix seconds. Null if we hold nothing. */
  lastSyncedAt: number | null;
}

/**
 * `sampleSize` is how far back to compare. Twenty is enough to notice a broken
 * webhook within a day on a shop this size, and cheap enough to run on every
 * admin page load.
 */
export async function checkSyncHealth(
  db: D1Database,
  shop: { id: string; shop_domain: string; access_token: string },
  sampleSize = 20
): Promise<SyncHealth> {
  const data = await shopifyGraphQL<RecentIdsResult>(shop.shop_domain, shop.access_token, RECENT_IDS_QUERY, {
    first: sampleSize,
  });
  const recent = data.orders.edges.map((e) => e.node);

  const local = await db
    .prepare("SELECT shopify_order_id FROM orders WHERE shop_id = ?")
    .bind(shop.id)
    .all<{ shopify_order_id: string }>();
  const held = new Set(local.results.map((r) => r.shopify_order_id));

  const newestRow = await db
    .prepare("SELECT order_number, synced_at FROM orders WHERE shop_id = ? ORDER BY created_at DESC LIMIT 1")
    .bind(shop.id)
    .first<{ order_number: string; synced_at: number }>();

  return {
    missing: recent.filter((n) => !held.has(n.id)).length,
    shopifyNewest: recent[0]?.name ?? null,
    ourNewest: newestRow?.order_number ?? null,
    lastSyncedAt: newestRow?.synced_at ?? null,
  };
}
