import { fetchMock } from "cloudflare:test";
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { listActiveLocations, getVariantState } from "../src/shopify/inventory";
import { SHOPIFY_API_VERSION } from "../src/shopify/graphql";
import { adjustInventory } from "../src/shopify/inventory";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

describe("listActiveLocations", () => {
  it("returns locations", async () => {
    fetchMock
      .get("https://demo.myshopify.com")
      .intercept({ path: `/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, method: "POST" })
      .reply(200, JSON.stringify({
        data: { locations: { edges: [{ node: { id: "gid://shopify/Location/1", name: "Main warehouse" } }] } },
      }));

    expect(await listActiveLocations("demo.myshopify.com", "tok")).toEqual([
      { id: "gid://shopify/Location/1", name: "Main warehouse" },
    ]);
  });
});

describe("getVariantState", () => {
  it("returns inventory item id, parsed BBD and per-location stock", async () => {
    fetchMock
      .get("https://demo.myshopify.com")
      .intercept({ path: `/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, method: "POST" })
      .reply(200, JSON.stringify({
        data: {
          productVariant: {
            displayName: "ACME Milk - 1L",
            image: { url: "https://cdn.example/variant.jpg" },
            product: {
              id: "gid://shopify/Product/1", title: "ACME Milk", featuredImage: { url: "https://cdn.example/product.jpg" },
              descriptionHtml: "<p><strong>Best Before Date (BBD) From: Mar 2027</strong></p>",
            },
            inventoryItem: {
              id: "gid://shopify/InventoryItem/1",
              inventoryLevels: {
                edges: [
                  { node: { location: { id: "gid://shopify/Location/1" }, quantities: [{ name: "available", quantity: 5 }] } },
                  { node: { location: { id: "gid://shopify/Location/2" }, quantities: [{ name: "available", quantity: 0 }] } },
                ],
              },
            },
          },
        },
      }));

    const state = await getVariantState("demo.myshopify.com", "tok", "gid://shopify/ProductVariant/1");
    expect(state).toEqual({
      inventoryItemId: "gid://shopify/InventoryItem/1",
      currentBbd: { kind: "parsed", year: 2027, month: 3, text: "Mar 2027" },
      stockByLocation: [
        { locationId: "gid://shopify/Location/1", available: 5 },
        { locationId: "gid://shopify/Location/2", available: 0 },
      ],
      productTitle: "ACME Milk - 1L",
      productId: "gid://shopify/Product/1",
      imageUrl: "https://cdn.example/variant.jpg",
    });
  });

  it("returns an absent BBD when the description has no BBD line, and falls back to the product image", async () => {
    fetchMock
      .get("https://demo.myshopify.com")
      .intercept({ path: `/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, method: "POST" })
      .reply(200, JSON.stringify({
        data: {
          productVariant: {
            displayName: "ACME Milk - 1L",
            image: null,
            product: {
              id: "gid://shopify/Product/1", title: "ACME Milk", featuredImage: { url: "https://cdn.example/product.jpg" },
              descriptionHtml: "",
            },
            inventoryItem: { id: "gid://shopify/InventoryItem/1", inventoryLevels: { edges: [] } },
          },
        },
      }));

    const state = await getVariantState("demo.myshopify.com", "tok", "gid://shopify/ProductVariant/1");
    expect(state!.currentBbd).toEqual({ kind: "absent" });
    expect(state?.stockByLocation).toEqual([]);
    expect(state?.imageUrl).toBe("https://cdn.example/product.jpg");
    expect(state?.productTitle).toBe("ACME Milk - 1L");
  });

  it("returns null when the variant no longer exists", async () => {
    fetchMock
      .get("https://demo.myshopify.com")
      .intercept({ path: `/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, method: "POST" })
      .reply(200, JSON.stringify({ data: { productVariant: null } }));

    expect(await getVariantState("demo.myshopify.com", "tok", "gid://shopify/ProductVariant/1")).toBeNull();
  });
});

describe("adjustInventory", () => {
  it("posts an inventoryAdjustQuantities mutation with the given delta", async () => {
    fetchMock
      .get("https://demo.myshopify.com")
      .intercept({ path: `/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, method: "POST" })
      .reply(200, JSON.stringify({ data: { inventoryAdjustQuantities: { userErrors: [] } } }));

    await expect(
      adjustInventory("demo.myshopify.com", "tok", "gid://shopify/InventoryItem/1", "gid://shopify/Location/1", 10)
    ).resolves.toBeUndefined();
  });

  it("throws when Shopify returns userErrors", async () => {
    fetchMock
      .get("https://demo.myshopify.com")
      .intercept({ path: `/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, method: "POST" })
      .reply(200, JSON.stringify({ data: { inventoryAdjustQuantities: { userErrors: [{ field: "input", message: "bad location" }] } } }));

    await expect(
      adjustInventory("demo.myshopify.com", "tok", "gid://shopify/InventoryItem/1", "gid://shopify/Location/bad", 10)
    ).rejects.toThrow(/bad location/);
  });
});
