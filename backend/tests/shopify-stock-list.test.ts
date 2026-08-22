// backend/tests/shopify-stock-list.test.ts
import { fetchMock } from "cloudflare:test";
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { SHOPIFY_API_VERSION } from "../src/shopify/graphql";
import { fetchStockRows, setInventoryQuantity } from "../src/shopify/stockList";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

function mockGraphQL(response: unknown, captured?: { body?: string }) {
  fetchMock
    .get("https://demo.myshopify.com")
    .intercept({
      path: `/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
      method: "POST",
      body: (body: string) => { if (captured) captured.body = body; return true; },
    })
    .reply(200, JSON.stringify(response));
}

const variantNode = (id: string, qty: number, descriptionHtml: string) => ({
  id,
  sku: "SKU-1",
  displayName: "Anchor Cream UHT - Default Title",
  image: null,
  inventoryItem: {
    id: "gid://shopify/InventoryItem/9",
    inventoryLevels: {
      edges: [{ node: { location: { id: "gid://shopify/Location/1" }, quantities: [{ name: "available", quantity: qty }] } }],
    },
  },
  product: { id: "gid://shopify/Product/5", title: "Anchor Cream UHT", featuredImage: { url: "https://img/1.png" }, descriptionHtml },
});

describe("fetchStockRows", () => {
  it("returns stock and the BBD parsed from the description", async () => {
    mockGraphQL({
      data: { nodes: [variantNode("gid://shopify/ProductVariant/1", 12, "<p><strong>Best Before Date (BBD) From: Dec 2026</strong></p>")] },
    });

    const rows = await fetchStockRows("demo.myshopify.com", "tok", ["gid://shopify/ProductVariant/1"]);
    const row = rows.get("gid://shopify/ProductVariant/1")!;

    expect(row.title).toBe("Anchor Cream UHT");
    expect(row.stockByLocation).toEqual([{ locationId: "gid://shopify/Location/1", available: 12 }]);
    expect(row.bbd).toMatchObject({ kind: "parsed", year: 2026, month: 12 });
    expect(row.imageUrl).toBe("https://img/1.png");
  });

  it("omits variants Shopify no longer resolves", async () => {
    // Deleting a product in Shopify leaves a null in the nodes array. One dead
    // product must not take the whole page down.
    mockGraphQL({ data: { nodes: [null, variantNode("gid://shopify/ProductVariant/2", 3, "")] } });

    const rows = await fetchStockRows("demo.myshopify.com", "tok", [
      "gid://shopify/ProductVariant/1",
      "gid://shopify/ProductVariant/2",
    ]);

    expect(rows.has("gid://shopify/ProductVariant/1")).toBe(false);
    expect(rows.get("gid://shopify/ProductVariant/2")!.bbd.kind).toBe("absent");
  });

  it("makes no request for an empty id list", async () => {
    // No interceptor is registered for this test, and fetchMock.disableNetConnect()
    // (set in beforeAll) rejects any real fetch that isn't matched by one. If
    // fetchStockRows made a request here, the await below would reject instead
    // of resolving.
    expect((await fetchStockRows("demo.myshopify.com", "tok", [])).size).toBe(0);
  });

  it("chunks ids into batches of 250", async () => {
    const ids = Array.from({ length: 251 }, (_, i) => `gid://shopify/ProductVariant/${i + 1}`);
    mockGraphQL({ data: { nodes: ids.slice(0, 250).map((id) => variantNode(id, 1, "")) } });
    mockGraphQL({ data: { nodes: [variantNode(ids[250], 1, "")] } });

    const rows = await fetchStockRows("demo.myshopify.com", "tok", ids);
    expect(rows.size).toBe(251);
  });
});

describe("setInventoryQuantity", () => {
  it("sends the counted value together with compareQuantity", async () => {
    const captured: { body?: string } = {};
    mockGraphQL({ data: { inventorySetQuantities: { userErrors: [] } } }, captured);

    await setInventoryQuantity("demo.myshopify.com", "tok", {
      inventoryItemId: "gid://shopify/InventoryItem/9",
      locationId: "gid://shopify/Location/1",
      quantity: 9,
      compareQuantity: 12,
    });

    const sent = JSON.parse(captured.body!);
    expect(sent.variables.input.quantities[0]).toMatchObject({
      inventoryItemId: "gid://shopify/InventoryItem/9",
      locationId: "gid://shopify/Location/1",
      quantity: 9,
      compareQuantity: 12,
    });
    expect(sent.variables.input.name).toBe("available");
    // The whole safety mechanism rests on this flag staying false: flipping it
    // to true makes Shopify accept a stale-derived write instead of rejecting
    // it, silently erasing whatever sold between page load and save.
    expect(sent.variables.input.ignoreCompareQuantity).toBe(false);
  });

  it("throws when Shopify rejects the comparison", async () => {
    // This is the whole point of compareQuantity: a sale landed between page
    // load and save, so the merchant's write must NOT go through silently.
    mockGraphQL({
      data: { inventorySetQuantities: { userErrors: [{ field: ["quantities"], message: "compareQuantity does not match persisted quantity" }] } },
    });

    await expect(
      setInventoryQuantity("demo.myshopify.com", "tok", {
        inventoryItemId: "gid://shopify/InventoryItem/9",
        locationId: "gid://shopify/Location/1",
        quantity: 9,
        compareQuantity: 12,
      })
    ).rejects.toThrow(/compareQuantity/);
  });
});
