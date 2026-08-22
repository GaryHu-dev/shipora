import { shopifyGraphQL } from "./graphql";
import { parseBbd, type BbdState } from "../bbd";

export interface StoreLocation {
  id: string;
  name: string;
  /** Shopify's default location (`shipsInventory`). Sorted first by listActiveLocations. */
  isDefault: boolean;
}

const LOCATIONS_QUERY = `
query ActiveLocations {
  locations(first: 50, query: "status:active") {
    edges { node { id name shipsInventory } }
  }
}`;

interface LocationsResult {
  locations: { edges: { node: { id: string; name: string; shipsInventory: boolean } }[] };
}

/**
 * Active locations, the shop's DEFAULT one first.
 *
 * Callers with no location picker take `[0]`, so the order here decides where
 * stock is written. Shopify's own order is not that answer: a development
 * store returns its sample "My Custom Location" (a Toronto address nobody
 * entered) ahead of the real "Shop location", and writing counts to the
 * sample warehouse produces numbers that read as correct in both of them.
 *
 * `shipsInventory` is the flag Shopify itself uses for the default location.
 */
export async function listActiveLocations(shopDomain: string, accessToken: string): Promise<StoreLocation[]> {
  const data = await shopifyGraphQL<LocationsResult>(shopDomain, accessToken, LOCATIONS_QUERY, {});
  const all = data.locations.edges.map((e) => ({
    id: e.node.id,
    name: e.node.name,
    isDefault: e.node.shipsInventory,
  }));
  // Stable: only the default is lifted, everything else keeps Shopify's order.
  return [...all.filter((l) => l.isDefault), ...all.filter((l) => !l.isDefault)];
}

export interface LocationStock {
  locationId: string;
  available: number;
}

export interface VariantState {
  inventoryItemId: string;
  currentBbd: BbdState;
  stockByLocation: LocationStock[];
  productTitle: string;
  productId: string;
  imageUrl: string | null;
  /** The page a customer sees. Null when the product is not published online. */
  onlineStoreUrl: string | null;
}

const VARIANT_STATE_QUERY = `
query VariantState($id: ID!) {
  productVariant(id: $id) {
    displayName
    image { url }
    product { id title featuredImage { url } descriptionHtml onlineStoreUrl onlineStorePreviewUrl }
    inventoryItem {
      id
      inventoryLevels(first: 50) {
        edges { node { location { id } quantities(names: ["available"]) { name quantity } } }
      }
    }
  }
}`;

interface VariantStateResult {
  productVariant: {
    displayName: string;
    image: { url: string } | null;
    product: { id: string; title: string; featuredImage: { url: string } | null; descriptionHtml: string; onlineStoreUrl: string | null; onlineStorePreviewUrl: string | null };
    inventoryItem: {
      id: string;
      inventoryLevels: {
        edges: { node: { location: { id: string }; quantities: { name: string; quantity: number }[] } }[];
      };
    };
  } | null;
}

export async function getVariantState(
  shopDomain: string,
  accessToken: string,
  variantId: string
): Promise<VariantState | null> {
  const data = await shopifyGraphQL<VariantStateResult>(shopDomain, accessToken, VARIANT_STATE_QUERY, {
    id: variantId,
  });
  const variant = data.productVariant;
  if (!variant) return null;

  return {
    inventoryItemId: variant.inventoryItem.id,
    currentBbd: parseBbd(variant.product.descriptionHtml),
    stockByLocation: variant.inventoryItem.inventoryLevels.edges.map((e) => ({
      locationId: e.node.location.id,
      available: e.node.quantities.find((q) => q.name === "available")?.quantity ?? 0,
    })),
    productTitle: variant.displayName.replace(/\s*-\s*Default Title$/i, ""),
    productId: variant.product.id,
    imageUrl: variant.image?.url ?? variant.product.featuredImage?.url ?? null,
    onlineStoreUrl: variant.product.onlineStoreUrl ?? variant.product.onlineStorePreviewUrl ?? null,
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
