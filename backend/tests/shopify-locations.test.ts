import { fetchMock } from "cloudflare:test";
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { listActiveLocations } from "../src/shopify/inventory";
import { SHOPIFY_API_VERSION } from "../src/shopify/graphql";

beforeAll(() => { fetchMock.activate(); fetchMock.disableNetConnect(); });
afterEach(() => fetchMock.assertNoPendingInterceptors());

function reply(nodes: { id: string; name: string; shipsInventory: boolean }[]) {
  fetchMock
    .get("https://demo.myshopify.com")
    .intercept({ path: `/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, method: "POST" })
    .reply(200, JSON.stringify({ data: { locations: { edges: nodes.map((node) => ({ node })) } } }));
}

describe("listActiveLocations", () => {
  it("puts the shop's default location first, whatever order Shopify returns", async () => {
    // Exactly what a development store returns: Shopify lists the sample
    // "My Custom Location" (a Toronto address nobody entered) BEFORE the real
    // default. Callers with no location picker take [0], so this order is
    // where stock gets written — and a count in the wrong warehouse reads as
    // correct in both of them.
    reply([
      { id: "gid://shopify/Location/1", name: "My Custom Location", shipsInventory: false },
      { id: "gid://shopify/Location/2", name: "Shop location", shipsInventory: true },
    ]);

    const locs = await listActiveLocations("demo.myshopify.com", "tok");
    expect(locs[0]).toEqual({ id: "gid://shopify/Location/2", name: "Shop location", isDefault: true });
    expect(locs).toHaveLength(2);
  });

  it("keeps Shopify's order among the non-default locations", async () => {
    reply([
      { id: "gid://shopify/Location/1", name: "Auckland", shipsInventory: true },
      { id: "gid://shopify/Location/2", name: "Wellington", shipsInventory: false },
      { id: "gid://shopify/Location/3", name: "Christchurch", shipsInventory: false },
    ]);

    const locs = await listActiveLocations("demo.myshopify.com", "tok");
    expect(locs.map((l) => l.name)).toEqual(["Auckland", "Wellington", "Christchurch"]);
  });

  it("returns the list unchanged when no location is flagged default", async () => {
    reply([
      { id: "gid://shopify/Location/1", name: "A", shipsInventory: false },
      { id: "gid://shopify/Location/2", name: "B", shipsInventory: false },
    ]);

    const locs = await listActiveLocations("demo.myshopify.com", "tok");
    expect(locs.map((l) => l.name)).toEqual(["A", "B"]);
  });
});
