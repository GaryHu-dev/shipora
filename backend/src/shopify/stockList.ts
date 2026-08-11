import { shopifyGraphQL } from "./graphql";
import { parseBbd, type BbdState } from "../bbd";

export interface StockRow {
  variantId: string;
  productId: string;
  title: string;
  sku: string | null;
  imageUrl: string | null;
  inventoryItemId: string;
  stockByLocation: { locationId: string; available: number }[];
  bbd: BbdState;
}

// Shopify caps nodes(ids:) at 250.
const BATCH = 250;

const STOCK_ROWS_QUERY = `
query StockRows($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on ProductVariant {
      id
      sku
      displayName
      image { url }
      inventoryItem {
        id
        inventoryLevels(first: 50) {
          edges { node { location { id } quantities(names: ["available"]) { name quantity } } }
        }
      }
      product { id title featuredImage { url } descriptionHtml }
    }
  }
}`;

interface VariantNode {
  id: string;
  sku: string | null;
  displayName: string;
  image: { url: string } | null;
  inventoryItem: {
    id: string;
    inventoryLevels: {
      edges: { node: { location: { id: string }; quantities: { name: string; quantity: number }[] } }[];
    };
  };
  product: { id: string; title: string; featuredImage: { url: string } | null; descriptionHtml: string | null };
}

interface StockRowsResult {
  nodes: (VariantNode | null)[];
}

/**
 * Live stock + BBD for the given variants, keyed by variant id.
 *
 * Nothing here is cached: the Stock tab shows what Shopify says right now.
 * Variants Shopify cannot resolve (deleted since being tracked) are simply
 * absent from the map — the caller decides how to present that.
 */
export async function fetchStockRows(
  shopDomain: string,
  accessToken: string,
  variantIds: string[]
): Promise<Map<string, StockRow>> {
  const out = new Map<string, StockRow>();
  if (variantIds.length === 0) return out;

  for (let i = 0; i < variantIds.length; i += BATCH) {
    const ids = variantIds.slice(i, i + BATCH);
    const data = await shopifyGraphQL<StockRowsResult>(shopDomain, accessToken, STOCK_ROWS_QUERY, { ids });

    for (const node of data.nodes) {
      if (!node) continue; // deleted in Shopify
      out.set(node.id, {
        variantId: node.id,
        productId: node.product.id,
        title: node.product.title,
        sku: node.sku,
        imageUrl: node.image?.url ?? node.product.featuredImage?.url ?? null,
        inventoryItemId: node.inventoryItem.id,
        stockByLocation: node.inventoryItem.inventoryLevels.edges.map((e) => ({
          locationId: e.node.location.id,
          available: e.node.quantities.find((q) => q.name === "available")?.quantity ?? 0,
        })),
        bbd: parseBbd(node.product.descriptionHtml),
      });
    }
  }
  return out;
}

const SET_INVENTORY_MUTATION = `
mutation SetInventory($input: InventorySetQuantitiesInput!) {
  inventorySetQuantities(input: $input) {
    userErrors { field message }
  }
}`;

interface SetInventoryResult {
  inventorySetQuantities: { userErrors: { field: string[] | string | null; message: string }[] };
}

/**
 * Set a variant's available stock at one location to an absolute counted value.
 *
 * `compareQuantity` is what makes this safe. It says "I believe the current
 * figure is N" — if a sale (or another admin) moved it since the page loaded,
 * Shopify rejects the write instead of accepting a number derived from stale
 * data, which would silently erase that sale. Callers must surface the
 * rejection to the merchant rather than retrying with a fresh comparison.
 */
export async function setInventoryQuantity(
  shopDomain: string,
  accessToken: string,
  args: { inventoryItemId: string; locationId: string; quantity: number; compareQuantity: number }
): Promise<void> {
  const data = await shopifyGraphQL<SetInventoryResult>(shopDomain, accessToken, SET_INVENTORY_MUTATION, {
    input: {
      name: "available",
      reason: "correction",
      ignoreCompareQuantity: false,
      quantities: [
        {
          inventoryItemId: args.inventoryItemId,
          locationId: args.locationId,
          quantity: args.quantity,
          compareQuantity: args.compareQuantity,
        },
      ],
    },
  });

  const errs = data.inventorySetQuantities.userErrors;
  if (errs.length > 0) {
    throw new Error(`inventorySetQuantities userErrors: ${errs.map((e) => e.message).join("; ")}`);
  }
}
