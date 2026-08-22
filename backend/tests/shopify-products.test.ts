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
              { node: { id: "gid://shopify/ProductVariant/1", sku: "500123", displayName: "ACME Milk - 12x1L", image: { url: "https://cdn.example/v1.jpg" }, product: { id: "gid://shopify/Product/1", featuredImage: null, onlineStoreUrl: "https://shop.example/products/acme-milk" } } },
              { node: { id: "gid://shopify/ProductVariant/2", sku: "500123X", displayName: "ACME Milk XL", image: null, product: { id: "gid://shopify/Product/2", featuredImage: null, onlineStoreUrl: null } } },
            ],
          },
        },
      }));

    const variant = await findVariantBySku("demo.myshopify.com", "tok", "500123");
    expect(variant).toEqual({ id: "gid://shopify/ProductVariant/1", sku: "500123", title: "ACME Milk - 12x1L", productId: "gid://shopify/Product/1", imageUrl: "https://cdn.example/v1.jpg", onlineStoreUrl: "https://shop.example/products/acme-milk" });
  });

  it("returns null when no candidate's SKU matches exactly", async () => {
    fetchMock
      .get("https://demo.myshopify.com")
      .intercept({ path: `/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, method: "POST" })
      .reply(200, JSON.stringify({
        data: { productVariants: { edges: [{ node: { id: "gid://shopify/ProductVariant/2", sku: "500123X", displayName: "ACME Milk XL", image: null, product: { id: "gid://shopify/Product/2", featuredImage: null, onlineStoreUrl: null } } }] } },
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
              onlineStoreUrl: "https://shop.example/products/acme-milk",
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
    expect(candidates).toEqual([{ id: "gid://shopify/ProductVariant/1", sku: "500123", title: "ACME Milk - 12x1L", productId: "gid://shopify/Product/1", imageUrl: "https://cdn.example/p1.jpg", onlineStoreUrl: "https://shop.example/products/acme-milk" }]);
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

  it("falls back to a contains-scan when nothing matches a prefix", async () => {
    // Shopify matches prefixes only: for SKU 3110886, `sku:311*` hits and
    // `sku:108*` does not — and `sku:*108*` is unsupported, verified against a
    // live shop. Typing a fragment from the middle of a code is a natural thing
    // to do, so an empty prefix result has to fall through to a scan.
    const sent: string[] = [];
    fetchMock
      .get("https://demo.myshopify.com")
      .intercept({ path: `/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, method: "POST" })
      .reply(200, (opts: { body?: string | null }) => {
        const body = JSON.parse(String(opts.body));
        sent.push(body.query);
        if (sent.length <= 2) return JSON.stringify({ data: { products: { edges: [] } } });
        return JSON.stringify({
          data: {
            productVariants: {
              edges: [
                { cursor: "c1", node: { id: "gid://shopify/ProductVariant/9", sku: "3110886", displayName: "Anchor Butter 500g - Default Title", image: null, product: { id: "gid://shopify/Product/9", featuredImage: { url: "https://cdn.example/p9.jpg" }, onlineStoreUrl: null } } },
                { cursor: "c2", node: { id: "gid://shopify/ProductVariant/8", sku: "9999999", displayName: "Something Else", image: null, product: { id: "gid://shopify/Product/8", featuredImage: null, onlineStoreUrl: null } } },
              ],
              pageInfo: { hasNextPage: false },
            },
          },
        });
      })
      .times(3);

    const hits = await searchVariantsByQuery("demo.myshopify.com", "tok", "108");
    expect(hits).toEqual([{
      id: "gid://shopify/ProductVariant/9",
      sku: "3110886",
      title: "Anchor Butter 500g",
      productId: "gid://shopify/Product/9",
      imageUrl: "https://cdn.example/p9.jpg",
      onlineStoreUrl: null,
    }]);
    expect(sent[2]).toContain("productVariants");
  });

  it("does not scan when the prefix search already found something", async () => {
    // The scan pages through the whole catalogue; it must stay a fallback.
    // assertNoPendingInterceptors() would fail if a second call were expected,
    // and an unmatched second call would throw — either way this pins it.
    fetchMock
      .get("https://demo.myshopify.com")
      .intercept({ path: `/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, method: "POST" })
      .reply(200, productsReply());

    const hits = await searchVariantsByQuery("demo.myshopify.com", "tok", "500123");
    expect(hits).toHaveLength(1);
  });

  it("never searches outside active products", async () => {
    // A draft is not stock anyone counts, and must never be what a delivery
    // note gets matched to. On the shop this was built for, 414 of 713
    // products are drafts. Note the two different field names and the
    // lowercase value — `product_status:ACTIVE` silently returns nothing.
    const sent: string[] = [];
    fetchMock
      .get("https://demo.myshopify.com")
      .intercept({ path: `/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, method: "POST" })
      .reply(200, (opts: { body?: string | null }) => {
        const body = JSON.parse(String(opts.body));
        sent.push(body.variables.query);
        if (sent.length <= 2) return JSON.stringify({ data: { products: { edges: [] } } });
        return JSON.stringify({ data: { productVariants: { edges: [], pageInfo: { hasNextPage: false } } } });
      })
      .times(3);

    await searchVariantsByQuery("demo.myshopify.com", "tok", "anchor 122352");

    // Both prefix passes: the status filter must bind to the whole group,
    // not to the last clause of it.
    expect(sent[0]).toMatch(/^\(.*\) AND status:active$/);
    expect(sent[1]).toMatch(/^\(.*\) AND status:active$/);
    // The scan fallback.
    expect(sent[2]).toBe("product_status:active");
  });

  it("only matches a SKU on an active product", async () => {
    let sent = "";
    fetchMock
      .get("https://demo.myshopify.com")
      .intercept({ path: `/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, method: "POST" })
      .reply(200, (opts: { body?: string | null }) => {
        sent = JSON.parse(String(opts.body)).variables.query;
        return JSON.stringify({ data: { productVariants: { edges: [] } } });
      });

    await findVariantBySku("demo.myshopify.com", "tok", "500123");
    expect(sent).toBe("sku:500123 AND product_status:active");
  });

  it("requires every term to match, so another word narrows the result", async () => {
    // "Anchor Butter" used to search `title:Anchor* OR ... OR title:Butter*`.
    // "Anchor" alone matches dozens of products, Shopify ranked that set its
    // own way, and the shop's two actual Anchor butters fell outside the
    // first ten — typing more of the name made the product HARDER to find.
    let sent = "";
    fetchMock
      .get("https://demo.myshopify.com")
      .intercept({ path: `/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, method: "POST" })
      .reply(200, (opts: { body?: string | null }) => {
        sent = JSON.parse(String(opts.body)).variables.query;
        return productsReply()(opts);
      });

    await searchVariantsByQuery("demo.myshopify.com", "tok", "Anchor Butter");

    // Each term is its own bracket, joined by AND — and title/sku stay OR'd
    // inside it, so "anchor 112419" (a name plus its code) still works.
    expect(sent).toBe("((title:Anchor* OR sku:Anchor*) AND (title:Butter* OR sku:Butter*)) AND status:active");
  });

  it("loosens to OR only when nothing matches every term", async () => {
    // A typo or an extra word the product does not carry must not produce an
    // empty list while a perfectly good partial match exists.
    const sent: string[] = [];
    fetchMock
      .get("https://demo.myshopify.com")
      .intercept({ path: `/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, method: "POST" })
      .reply(200, (opts: { body?: string | null }) => {
        sent.push(JSON.parse(String(opts.body)).variables.query);
        if (sent.length === 1) return JSON.stringify({ data: { products: { edges: [] } } });
        return productsReply()(opts);
      })
      .times(2);

    const hits = await searchVariantsByQuery("demo.myshopify.com", "tok", "Anchor Buttr");
    expect(hits).toHaveLength(1);
    expect(sent[0]).toContain(" AND (title:Buttr*");
    expect(sent[1]).toBe("(title:Anchor* OR sku:Anchor* OR title:Buttr* OR sku:Buttr*) AND status:active");
  });

  it("falls back to the preview URL when a product is not published", async () => {
    // onlineStoreUrl is null for anything not on the Online Store channel, and
    // a hand-built /products/<handle> would 404 for exactly those. Shopify's
    // own preview URL shows the same customer-facing page, so a merchant can
    // still see what they are about to count.
    fetchMock
      .get("https://demo.myshopify.com")
      .intercept({ path: `/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, method: "POST" })
      .reply(200, JSON.stringify({
        data: {
          products: {
            edges: [{
              node: {
                id: "gid://shopify/Product/1",
                featuredImage: null,
                onlineStoreUrl: null,
                onlineStorePreviewUrl: "https://demo.myshopify.com/products/acme-milk",
                variants: { edges: [{ node: { id: "gid://shopify/ProductVariant/1", sku: "500123", displayName: "ACME Milk", image: null } }] },
              },
            }],
          },
        },
      }));

    const hits = await searchVariantsByQuery("demo.myshopify.com", "tok", "500123");
    expect(hits[0].onlineStoreUrl).toBe("https://demo.myshopify.com/products/acme-milk");
  });

  it("searches every term as a SKU, not just the first", async () => {
    // Typing a product name and then its code is the natural thing to do, and
    // the code is the part that identifies it. Only terms[0] used to reach the
    // sku field, so "anchor 122352" searched sku:anchor* and never the code.
    let sentQuery = "";
    fetchMock
      .get("https://demo.myshopify.com")
      .intercept({ path: `/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, method: "POST" })
      .reply(200, productsReply((q) => { sentQuery = q; }));

    await searchVariantsByQuery("demo.myshopify.com", "tok", "anchor 122352");
    expect(sentQuery).toContain("sku:122352*");
    expect(sentQuery).toContain("title:122352*");
    expect(sentQuery).toContain("sku:anchor*");
  });

  it("keeps a hyphen inside a SKU but never leaves it as an operator", async () => {
    let sentQuery = "";
    fetchMock
      .get("https://demo.myshopify.com")
      .intercept({ path: `/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, method: "POST" })
      .reply(200, productsReply((q) => { sentQuery = q; }));

    await searchVariantsByQuery("demo.myshopify.com", "tok", "ANC-122352 -butter");
    expect(sentQuery).toContain("sku:ANC-122352*");
    // A leading hyphen is Shopify's exclusion operator; it must not survive.
    expect(sentQuery).not.toContain(":-");
    expect(sentQuery).toContain("title:butter*");
  });

  it("returns [] for a too-short query", async () => {
    expect(await searchVariantsByQuery("demo.myshopify.com", "tok", "a")).toEqual([]);
  });
});
