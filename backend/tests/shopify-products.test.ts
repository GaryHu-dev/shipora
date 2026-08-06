import { fetchMock } from "cloudflare:test";
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { findVariantBySku, searchVariantCandidates, searchVariantsByQuery } from "../src/shopify/products";
import { SHOPIFY_API_VERSION } from "../src/shopify/graphql";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

describe("findVariantBySku", () => {
  it("returns the variant when a candidate's SKU matches exactly", async () => {
    fetchMock
      .get("https://demo.myshopify.com")
      .intercept({ path: `/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, method: "POST" })
      .reply(200, JSON.stringify({
        data: {
          productVariants: {
            edges: [
              { node: { id: "gid://shopify/ProductVariant/1", sku: "500123", displayName: "ACME Milk - 12x1L", image: { url: "https://cdn.example/v1.jpg" }, product: { id: "gid://shopify/Product/1", featuredImage: null } } },
              { node: { id: "gid://shopify/ProductVariant/2", sku: "500123X", displayName: "ACME Milk XL", image: null, product: { id: "gid://shopify/Product/2", featuredImage: null } } },
            ],
          },
        },
      }));

    const variant = await findVariantBySku("demo.myshopify.com", "tok", "500123");
    expect(variant).toEqual({ id: "gid://shopify/ProductVariant/1", sku: "500123", title: "ACME Milk - 12x1L", productId: "gid://shopify/Product/1", imageUrl: "https://cdn.example/v1.jpg" });
  });

  it("returns null when no candidate's SKU matches exactly", async () => {
    fetchMock
      .get("https://demo.myshopify.com")
      .intercept({ path: `/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, method: "POST" })
      .reply(200, JSON.stringify({
        data: { productVariants: { edges: [{ node: { id: "gid://shopify/ProductVariant/2", sku: "500123X", displayName: "ACME Milk XL", image: null, product: { id: "gid://shopify/Product/2", featuredImage: null } } }] } },
      }));

    expect(await findVariantBySku("demo.myshopify.com", "tok", "500123")).toBeNull();
  });
});

// Title search hits the products connection (not productVariants) and flattens
// each matching product's variants into candidates.
function productsReply(sink?: (q: string) => void): (opts: { body?: string | null }) => string {
  return (opts) => {
    if (sink) sink(JSON.parse(String(opts.body)).variables.query);
    return JSON.stringify({
      data: {
        products: {
          edges: [{
            node: {
              id: "gid://shopify/Product/1",
              featuredImage: { url: "https://cdn.example/p1.jpg" },
              variants: { edges: [{ node: { id: "gid://shopify/ProductVariant/1", sku: "500123", displayName: "ACME Milk - 12x1L", image: null } }] } },
          }],
        },
      },
    });
  };
}

describe("searchVariantCandidates", () => {
  it("returns variants of matching products, using the product featured image as a fallback", async () => {
    fetchMock
      .get("https://demo.myshopify.com")
      .intercept({ path: `/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, method: "POST" })
      .reply(200, productsReply());

    const candidates = await searchVariantCandidates("demo.myshopify.com", "tok", "ACME FULL CREAM MILK");
    expect(candidates).toEqual([{ id: "gid://shopify/ProductVariant/1", sku: "500123", title: "ACME Milk - 12x1L", productId: "gid://shopify/Product/1", imageUrl: "https://cdn.example/p1.jpg" }]);
  });
});

describe("searchVariantsByQuery (manual picker)", () => {
  it("builds a forgiving title-prefix + sku query against products and returns candidates", async () => {
    let sentQuery = "";
    fetchMock
      .get("https://demo.myshopify.com")
      .intercept({ path: `/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, method: "POST" })
      .reply(200, productsReply((q) => { sentQuery = q; }));

    // A messy query with a Shopify operator ("-") that must not become an exclusion.
    const candidates = await searchVariantsByQuery("demo.myshopify.com", "tok", "Anchor Blue Milk - Default Title");
    expect(candidates[0].id).toBe("gid://shopify/ProductVariant/1");
    // No leading wildcards (Shopify doesn't support them); no bare "-" operator.
    expect(sentQuery).not.toContain(":*");
    expect(sentQuery).toContain("title:Anchor*");
    expect(sentQuery).toContain("sku:Anchor*");
  });

  it("returns [] for a too-short query", async () => {
    expect(await searchVariantsByQuery("demo.myshopify.com", "tok", "a")).toEqual([]);
  });
});
