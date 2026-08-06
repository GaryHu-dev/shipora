import { shopifyGraphQL } from "./graphql";

export const EXPIRY_METAFIELD_NAMESPACE = "shipora";
export const EXPIRY_METAFIELD_KEY = "expiry_date";

export interface StoreLocation {
  id: string;
  name: string;
}

const LOCATIONS_QUERY = `
query ActiveLocations {
  locations(first: 50, query: "status:active") {
    edges { node { id name } }
  }
}`;

interface LocationsResult {
  locations: { edges: { node: { id: string; name: string } }[] };
}

export async function listActiveLocations(shopDomain: string, accessToken: string): Promise<StoreLocation[]> {
  const data = await shopifyGraphQL<LocationsResult>(shopDomain, accessToken, LOCATIONS_QUERY, {});
  return data.locations.edges.map((e) => ({ id: e.node.id, name: e.node.name }));
}

export interface LocationStock {
  locationId: string;
  available: number;
}

export interface VariantState {
  inventoryItemId: string;
  expiryDate: string | null;
  stockByLocation: LocationStock[];
  productTitle: string;
  productId: string;
  imageUrl: string | null;
}

const VARIANT_STATE_QUERY = `
query VariantState($id: ID!, $namespace: String!, $key: String!) {
  productVariant(id: $id) {
    displayName
    image { url }
    product { id title featuredImage { url } }
    inventoryItem {
      id
      inventoryLevels(first: 50) {
        edges { node { location { id } quantities(names: ["available"]) { name quantity } } }
      }
    }
    metafield(namespace: $namespace, key: $key) { value }
  }
}`;

interface VariantStateResult {
  productVariant: {
    displayName: string;
    image: { url: string } | null;
    product: { id: string; title: string; featuredImage: { url: string } | null };
    inventoryItem: {
      id: string;
      inventoryLevels: {
        edges: { node: { location: { id: string }; quantities: { name: string; quantity: number }[] } }[];
      };
    };
    metafield: { value: string } | null;
  } | null;
}

export async function getVariantState(
  shopDomain: string,
  accessToken: string,
  variantId: string
): Promise<VariantState | null> {
  const data = await shopifyGraphQL<VariantStateResult>(shopDomain, accessToken, VARIANT_STATE_QUERY, {
    id: variantId,
    namespace: EXPIRY_METAFIELD_NAMESPACE,
    key: EXPIRY_METAFIELD_KEY,
  });
  const variant = data.productVariant;
  if (!variant) return null;

  return {
    inventoryItemId: variant.inventoryItem.id,
    expiryDate: variant.metafield?.value ?? null,
    stockByLocation: variant.inventoryItem.inventoryLevels.edges.map((e) => ({
      locationId: e.node.location.id,
      available: e.node.quantities.find((q) => q.name === "available")?.quantity ?? 0,
    })),
    productTitle: variant.displayName.replace(/\s*-\s*Default Title$/i, ""),
    productId: variant.product.id,
    imageUrl: variant.image?.url ?? variant.product.featuredImage?.url ?? null,
  };
}

const ADJUST_INVENTORY_MUTATION = `
mutation AdjustInventory($input: InventoryAdjustQuantitiesInput!) {
  inventoryAdjustQuantities(input: $input) {
    userErrors { field message }
  }
}`;

interface AdjustInventoryResult {
  inventoryAdjustQuantities: { userErrors: { field: string[] | string | null; message: string }[] };
}

export async function adjustInventory(
  shopDomain: string,
  accessToken: string,
  inventoryItemId: string,
  locationId: string,
  delta: number
): Promise<void> {
  const data = await shopifyGraphQL<AdjustInventoryResult>(shopDomain, accessToken, ADJUST_INVENTORY_MUTATION, {
    input: {
      reason: "restock",
      name: "available",
      changes: [{ delta, inventoryItemId, locationId }],
    },
  });
  const errs = data.inventoryAdjustQuantities.userErrors;
  if (errs.length > 0) throw new Error(`inventoryAdjustQuantities userErrors: ${errs.map((e) => e.message).join("; ")}`);
}

const SET_METAFIELDS_MUTATION = `
mutation SetMetafields($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    userErrors { field message }
  }
}`;

interface SetMetafieldsResult {
  metafieldsSet: { userErrors: { field: string[] | string | null; message: string }[] };
}

export async function setExpiryDateMetafield(
  shopDomain: string,
  accessToken: string,
  variantId: string,
  isoDate: string
): Promise<void> {
  const data = await shopifyGraphQL<SetMetafieldsResult>(shopDomain, accessToken, SET_METAFIELDS_MUTATION, {
    metafields: [
      { ownerId: variantId, namespace: EXPIRY_METAFIELD_NAMESPACE, key: EXPIRY_METAFIELD_KEY, type: "date", value: isoDate },
    ],
  });
  const errs = data.metafieldsSet.userErrors;
  if (errs.length > 0) throw new Error(`metafieldsSet userErrors: ${errs.map((e) => e.message).join("; ")}`);
}
