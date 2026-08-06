import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { getVariantIdForMaterialCode, upsertMaterialCodeMap } from "../src/db/materialCodeMap";

beforeEach(async () => {
  await env.DB.prepare(
    "INSERT INTO shops (id, shop_domain, access_token, join_secret, status, installed_at) VALUES (?,?,?,?,?,?)"
  ).bind("shop_1", "a.myshopify.com", "tok", "sec", "active", 1).run();
});

describe("material code map", () => {
  it("returns null when no mapping exists", async () => {
    expect(await getVariantIdForMaterialCode(env.DB, "shop_1", "500123")).toBeNull();
  });

  it("stores and reads back a mapping", async () => {
    await upsertMaterialCodeMap(env.DB, {
      id: "map_1", shopId: "shop_1", materialCode: "500123",
      shopifyVariantId: "gid://shopify/ProductVariant/1", updatedAt: 100,
    });
    expect(await getVariantIdForMaterialCode(env.DB, "shop_1", "500123")).toBe("gid://shopify/ProductVariant/1");
  });

  it("upserting the same shop+material_code replaces the variant id", async () => {
    await upsertMaterialCodeMap(env.DB, {
      id: "map_1", shopId: "shop_1", materialCode: "500123",
      shopifyVariantId: "gid://shopify/ProductVariant/1", updatedAt: 100,
    });
    await upsertMaterialCodeMap(env.DB, {
      id: "map_2", shopId: "shop_1", materialCode: "500123",
      shopifyVariantId: "gid://shopify/ProductVariant/2", updatedAt: 200,
    });
    expect(await getVariantIdForMaterialCode(env.DB, "shop_1", "500123")).toBe("gid://shopify/ProductVariant/2");
  });

  it("scopes lookups by shop", async () => {
    await env.DB.prepare(
      "INSERT INTO shops (id, shop_domain, access_token, join_secret, status, installed_at) VALUES (?,?,?,?,?,?)"
    ).bind("shop_2", "b.myshopify.com", "tok", "sec", "active", 1).run();
    await upsertMaterialCodeMap(env.DB, {
      id: "map_1", shopId: "shop_1", materialCode: "500123",
      shopifyVariantId: "gid://shopify/ProductVariant/1", updatedAt: 100,
    });
    expect(await getVariantIdForMaterialCode(env.DB, "shop_2", "500123")).toBeNull();
  });
});
