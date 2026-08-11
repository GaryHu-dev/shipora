import { fetchMock } from "cloudflare:test";
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { orchestrateParse } from "../src/routes/purchaseOrders";
import { SHOPIFY_API_VERSION } from "../src/shopify/graphql";
import type { ParsedLine } from "../src/purchaseOrders/parseFonterra";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

const SHOP = { shop_domain: "demo.myshopify.com", access_token: "tok" };

function mockGraphQL(response: unknown) {
  fetchMock
    .get("https://demo.myshopify.com")
    .intercept({ path: `/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, method: "POST" })
    .reply(200, JSON.stringify(response));
}

describe("orchestrateParse", () => {
  it("matches a line by exact SKU and attaches current stock/expiry", async () => {
    const lines: ParsedLine[] = [{ materialCode: "500123", description: "ACME MILK", sled: "15.03.2027", deliveredQty: 10 }];

    mockGraphQL({ data: { locations: { edges: [{ node: { id: "gid://shopify/Location/1", name: "Main" } }] } } }); // listActiveLocations
    mockGraphQL({ data: { productVariants: { edges: [{ node: { id: "gid://shopify/ProductVariant/1", sku: "500123", displayName: "ACME Milk", image: null, product: { id: "gid://shopify/Product/1", featuredImage: null } } }] } } }); // findVariantBySku
    mockGraphQL({
      data: {
        productVariant: {
          displayName: "ACME Milk",
          image: { url: "https://cdn.example/v1.jpg" },
          product: { id: "gid://shopify/Product/1", title: "ACME Milk", featuredImage: null, descriptionHtml: "" },
          inventoryItem: { id: "gid://shopify/InventoryItem/1", inventoryLevels: { edges: [{ node: { location: { id: "gid://shopify/Location/1" }, quantities: [{ name: "available", quantity: 2 }] } }] } },
        },
      },
    }); // getVariantState

    const result = await orchestrateParse({} as D1Database, SHOP, lines, {
      getVariantIdForMaterialCode: async () => null,
    });

    expect(result.shopDomain).toBe("demo.myshopify.com");
    expect(result.locations).toEqual([{ id: "gid://shopify/Location/1", name: "Main" }]);
    expect(result.lines[0].match).toMatchObject({
      variantId: "gid://shopify/ProductVariant/1",
      matchSource: "sku",
      currentBbd: { kind: "absent" },
      stockByLocation: [{ locationId: "gid://shopify/Location/1", available: 2 }],
      productId: "gid://shopify/Product/1",
      imageUrl: "https://cdn.example/v1.jpg",
    });
  });

  it("falls back to the material_code_map when SKU doesn't match", async () => {
    const lines: ParsedLine[] = [{ materialCode: "500123", description: "ACME MILK", sled: "15.03.2027", deliveredQty: 10 }];

    mockGraphQL({ data: { locations: { edges: [] } } });
    mockGraphQL({ data: { productVariants: { edges: [] } } }); // findVariantBySku: no match
    mockGraphQL({
      data: {
        productVariant: {
          displayName: "ACME Milk",
          image: null,
          product: {
            id: "gid://shopify/Product/9", title: "ACME Milk", featuredImage: null,
            descriptionHtml: "<p><strong>Best Before Date (BBD) From: Jan 2027</strong></p>",
          },
          inventoryItem: { id: "gid://shopify/InventoryItem/1", inventoryLevels: { edges: [] } },
        },
      },
    }); // getVariantState for the mapped variant

    const result = await orchestrateParse({} as D1Database, SHOP, lines, {
      getVariantIdForMaterialCode: async () => "gid://shopify/ProductVariant/9",
    });

    expect(result.lines[0].match?.matchSource).toBe("mapping");
    expect(result.lines[0].match?.variantId).toBe("gid://shopify/ProductVariant/9");
  });

  it("falls back to fuzzy title matching when there's no SKU or mapping hit", async () => {
    const lines: ParsedLine[] = [{ materialCode: "999999", description: "ACME FULL CREAM MILK 12X1L", sled: "15.03.2027", deliveredQty: 10 }];

    mockGraphQL({ data: { locations: { edges: [] } } });
    mockGraphQL({ data: { productVariants: { edges: [] } } }); // findVariantBySku: no match
    mockGraphQL({ data: { products: { edges: [{ node: { id: "gid://shopify/Product/7", featuredImage: null, variants: { edges: [{ node: { id: "gid://shopify/ProductVariant/7", sku: "A7", displayName: "ACME FULL CREAM MILK 12X1L", image: null } }] } } }] } } }); // searchVariantCandidates (products connection)
    mockGraphQL({
      data: {
        productVariant: {
          displayName: "ACME FULL CREAM MILK 12X1L",
          image: null,
          product: { id: "gid://shopify/Product/7", title: "ACME FULL CREAM MILK", featuredImage: null, descriptionHtml: "" },
          inventoryItem: { id: "gid://shopify/InventoryItem/7", inventoryLevels: { edges: [] } },
        },
      },
    }); // getVariantState

    const result = await orchestrateParse({} as D1Database, SHOP, lines, {
      getVariantIdForMaterialCode: async () => null,
    });

    expect(result.lines[0].match?.matchSource).toBe("fuzzy");
    expect(result.lines[0].match?.variantId).toBe("gid://shopify/ProductVariant/7");
  });

  it("leaves match null when nothing matches at all", async () => {
    const lines: ParsedLine[] = [{ materialCode: "999999", description: "TOTALLY UNKNOWN PRODUCT", sled: "15.03.2027", deliveredQty: 10 }];

    mockGraphQL({ data: { locations: { edges: [] } } });
    mockGraphQL({ data: { productVariants: { edges: [] } } }); // findVariantBySku
    mockGraphQL({ data: { products: { edges: [] } } }); // searchVariantCandidates (products connection)

    const result = await orchestrateParse({} as D1Database, SHOP, lines, {
      getVariantIdForMaterialCode: async () => null,
    });

    expect(result.lines[0].match).toBeNull();
  });
});
