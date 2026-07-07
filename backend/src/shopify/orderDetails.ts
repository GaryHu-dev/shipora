import { shopifyGraphQL, SHOPIFY_API_VERSION } from "./graphql";

const ITEMS_QUERY = `
query OrderItems($id: ID!) {
  order(id: $id) {
    lineItems(first: 100) {
      edges { node { title quantity sku image { url } } }
    }
  }
}`;

interface ItemsResult {
  order: { lineItems: { edges: { node: { title: string; quantity: number; sku: string | null; image: { url: string } | null } }[] } } | null;
}

export interface OrderLineItem {
  title: string;
  quantity: number;
  sku: string | null;
  imageUrl: string | null;
}

export async function fetchOrderLineItems(shopDomain: string, accessToken: string, orderGid: string): Promise<OrderLineItem[]> {
  const data = await shopifyGraphQL<ItemsResult>(shopDomain, accessToken, ITEMS_QUERY, { id: orderGid });
  return (
    data.order?.lineItems?.edges?.map((e) => ({
      title: e.node.title,
      quantity: e.node.quantity,
      sku: e.node.sku ?? null,
      imageUrl: e.node.image?.url ?? null,
    })) ?? []
  );
}

// Addresses are protected customer data — kept in their own query so a field
// denial doesn't break the line-items fetch. No `fulfillmentOrders` here: that
// field needs a fulfillment scope and, when denied, nulls the whole order.
const ADDRESS_QUERY = `
query OrderAddresses($id: ID!) {
  order(id: $id) {
    shippingAddress { name address1 address2 city province zip country phone }
    billingAddress { name address1 address2 city province zip country phone }
  }
}`;

export interface ShippingAddress {
  name: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  province: string | null;
  zip: string | null;
  country: string | null;
  phone: string | null;
}

export interface Addresses {
  shipping: ShippingAddress | null;
  billing: ShippingAddress | null;
}

interface AddressResult {
  data?: { order: { shippingAddress: ShippingAddress | null; billingAddress: ShippingAddress | null } | null };
}

// Uses a raw request (not shopifyGraphQL) so field-level "protected data" denials
// — Shopify returns partial data AND an errors array — don't discard the fields
// we ARE allowed to read.
export async function fetchAddresses(shopDomain: string, accessToken: string, orderGid: string): Promise<Addresses> {
  const empty: Addresses = { shipping: null, billing: null };
  const res = await fetch(`https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-Shopify-Access-Token": accessToken },
    body: JSON.stringify({ query: ADDRESS_QUERY, variables: { id: orderGid } }),
  });
  if (!res.ok) return empty;
  const json = (await res.json()) as AddressResult;
  const order = json.data?.order;
  if (!order) return empty;
  return { shipping: order.shippingAddress ?? null, billing: order.billingAddress ?? null };
}
