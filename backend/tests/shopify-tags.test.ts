import { fetchMock } from "cloudflare:test";
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { addOrderTag } from "../src/shopify/tags";
import { SHOPIFY_API_VERSION } from "../src/shopify/graphql";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

describe("addOrderTag", () => {
  it("posts a tagsAdd mutation to the shop's GraphQL endpoint", async () => {
    fetchMock
      .get("https://demo.myshopify.com")
      .intercept({ path: `/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, method: "POST" })
      .reply(200, JSON.stringify({ data: { tagsAdd: { node: { id: "gid://order/1" }, userErrors: [] } } }));

    await expect(addOrderTag("demo.myshopify.com", "tok", "gid://order/1", "Shipping photos uploaded")).resolves.toBeUndefined();
  });

  it("throws when Shopify returns userErrors", async () => {
    fetchMock
      .get("https://demo.myshopify.com")
      .intercept({ path: `/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, method: "POST" })
      .reply(200, JSON.stringify({ data: { tagsAdd: { node: null, userErrors: [{ field: "id", message: "bad id" }] } } }));

    await expect(addOrderTag("demo.myshopify.com", "tok", "bad", "x")).rejects.toThrow(/bad id/);
  });
});
