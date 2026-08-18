import { shopifyGraphQL } from "./graphql";
import { upsertOrder } from "../db/orders";
import { newId } from "../ids";

export function mapFulfillment(displayStatus: string): "fulfilled" | "unfulfilled" {
  return displayStatus === "FULFILLED" ? "fulfilled" : "unfulfilled";
}

// `order.customer` would need read_customers, which this app does not ask for
// — but the name on the shipping or billing address is reachable under the
// scopes it already has, and the order-detail screen has been reading exactly
// that all along. This used to store null and claim the scope made it
// impossible, which left every order that arrived by sync rather than by
// webhook with a blank name: 268 of them, before this was noticed.
const ORDERS_QUERY = `
query RecentOrders($first: Int!, $query: String!) {
  orders(first: $first, sortKey: CREATED_AT, reverse: true, query: $query) {
    edges {
      node {
        id
        name
        createdAt
        displayFulfillmentStatus
        shippingAddress { name }
        billingAddress { name }
      }
    }
    pageInfo { hasNextPage }
  }
}`;

interface OrdersResult {
  orders: {
    edges: {
      node: {
        id: string;
        name: string;
        createdAt: string;
        displayFulfillmentStatus: string;
        shippingAddress: { name: string | null } | null;
        billingAddress: { name: string | null } | null;
      };
    }[];
    pageInfo: { hasNextPage: boolean };
  };
}

export async function syncRecentOrders(
  db: D1Database,
  shop: { id: string; shop_domain: string; access_token: string },
  nowSeconds: number
): Promise<number> {
  const sinceIso = new Date((nowSeconds - 60 * 24 * 60 * 60) * 1000).toISOString();
  const data = await shopifyGraphQL<OrdersResult>(shop.shop_domain, shop.access_token, ORDERS_QUERY, {
    first: 250,
    query: `created_at:>${sinceIso}`,
  });

  let count = 0;
  for (const edge of data.orders.edges) {
    const n = edge.node;
    await upsertOrder(db, {
      id: newId("order"),
      shopId: shop.id,
      shopifyOrderId: n.id,
      orderNumber: n.name,
      customerName: n.shippingAddress?.name ?? n.billingAddress?.name ?? null,
      fulfillmentStatus: mapFulfillment(n.displayFulfillmentStatus),
      createdAt: Math.floor(Date.parse(n.createdAt) / 1000),
      syncedAt: nowSeconds,
    });
    count++;
  }
  return count;
}
