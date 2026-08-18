import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { getVariantIdForMaterialCode, upsertMaterialCodeMap, listMaterialCodeMaps, deleteMaterialCodeMap } from "../src/db/materialCodeMap";

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

  it("lists a shop's mappings, and only that shop's", async () => {
    await env.DB.prepare(
      "INSERT INTO shops (id, shop_domain, access_token, join_secret, status, installed_at) VALUES (?,?,?,?,?,?)"
    ).bind("shop_2", "b.myshopify.com", "tok", "sec", "active", 1).run();
    await upsertMaterialCodeMap(env.DB, { id: "m1", shopId: "shop_1", materialCode: "500123", shopifyVariantId: "gid://shopify/ProductVariant/1", updatedAt: 100 });
    await upsertMaterialCodeMap(env.DB, { id: "m2", shopId: "shop_1", materialCode: "122352", shopifyVariantId: "gid://shopify/ProductVariant/2", updatedAt: 200 });
    await upsertMaterialCodeMap(env.DB, { id: "m3", shopId: "shop_2", materialCode: "999", shopifyVariantId: "gid://shopify/ProductVariant/9", updatedAt: 300 });

    const rows = await listMaterialCodeMaps(env.DB, "shop_1");
    expect(rows.map((r) => r.materialCode)).toEqual(["122352", "500123"]);
    expect(await listMaterialCodeMaps(env.DB, "shop_2")).toHaveLength(1);
  });

  it("deletes one mapping without touching another shop's identical code", async () => {
    // A wrong mapping is applied silently on every later import, so removing it
    // has to actually remove it — and only for the shop that asked.
    await env.DB.prepare(
      "INSERT INTO shops (id, shop_domain, access_token, join_secret, status, installed_at) VALUES (?,?,?,?,?,?)"
    ).bind("shop_2", "b.myshopify.com", "tok", "sec", "active", 1).run();
    await upsertMaterialCodeMap(env.DB, { id: "m1", shopId: "shop_1", materialCode: "500123", shopifyVariantId: "gid://shopify/ProductVariant/1", updatedAt: 100 });
    await upsertMaterialCodeMap(env.DB, { id: "m2", shopId: "shop_2", materialCode: "500123", shopifyVariantId: "gid://shopify/ProductVariant/9", updatedAt: 100 });

    await deleteMaterialCodeMap(env.DB, "shop_1", "500123");
    expect(await getVariantIdForMaterialCode(env.DB, "shop_1", "500123")).toBeNull();
    expect(await getVariantIdForMaterialCode(env.DB, "shop_2", "500123")).toBe("gid://shopify/ProductVariant/9");
  });
});
