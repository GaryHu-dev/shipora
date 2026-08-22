import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import {
  listTrackedProducts, addTrackedProduct, removeTrackedProduct, markCounted,
} from "../src/db/trackedProducts";

const V1 = "gid://shopify/ProductVariant/1";
const P1 = "gid://shopify/Product/1";

beforeEach(async () => {
  await env.DB.prepare(
    "INSERT INTO shops (id, shop_domain, access_token, join_secret, status, installed_at) VALUES (?,?,?,?,?,?)"
  ).bind("shop_1", "a.myshopify.com", "tok", "sec", "active", 1).run();
});

describe("tracked products", () => {
  it("starts empty", async () => {
    expect(await listTrackedProducts(env.DB, "shop_1")).toEqual([]);
  });

  it("adds and reads back a product", async () => {
    await addTrackedProduct(env.DB, {
      id: "tp_1", shopId: "shop_1", shopifyVariantId: V1, shopifyProductId: P1, addedAt: 100,
    });
    expect(await listTrackedProducts(env.DB, "shop_1")).toEqual([
      { shopifyVariantId: V1, shopifyProductId: P1, addedAt: 100, lastCountedAt: null, lastBbdCheckedAt: null },
    ]);
  });

  it("adding the same variant twice is a no-op, not an error", async () => {
    // Import confirm re-adds every matched line each time; a merchant importing
    // the same product weekly must not blow up or duplicate the row.
    await addTrackedProduct(env.DB, { id: "tp_1", shopId: "shop_1", shopifyVariantId: V1, shopifyProductId: P1, addedAt: 100 });
    await addTrackedProduct(env.DB, { id: "tp_2", shopId: "shop_1", shopifyVariantId: V1, shopifyProductId: P1, addedAt: 200 });

    const rows = await listTrackedProducts(env.DB, "shop_1");
    expect(rows).toHaveLength(1);
    expect(rows[0].addedAt).toBe(100); // the original add is preserved
  });

  it("re-adding does not wipe count progress", async () => {
    await addTrackedProduct(env.DB, { id: "tp_1", shopId: "shop_1", shopifyVariantId: V1, shopifyProductId: P1, addedAt: 100 });
    await markCounted(env.DB, "shop_1", V1, 500);
    await addTrackedProduct(env.DB, { id: "tp_2", shopId: "shop_1", shopifyVariantId: V1, shopifyProductId: P1, addedAt: 600 });

    expect((await listTrackedProducts(env.DB, "shop_1"))[0].lastCountedAt).toBe(500);
  });

  it("records when a product was counted", async () => {
    await addTrackedProduct(env.DB, { id: "tp_1", shopId: "shop_1", shopifyVariantId: V1, shopifyProductId: P1, addedAt: 100 });
    await markCounted(env.DB, "shop_1", V1, 777);
    expect((await listTrackedProducts(env.DB, "shop_1"))[0].lastCountedAt).toBe(777);
  });

  it("removes a product", async () => {
    await addTrackedProduct(env.DB, { id: "tp_1", shopId: "shop_1", shopifyVariantId: V1, shopifyProductId: P1, addedAt: 100 });
    await removeTrackedProduct(env.DB, "shop_1", V1);
    expect(await listTrackedProducts(env.DB, "shop_1")).toEqual([]);
  });

  it("isolates shops from each other", async () => {
    await env.DB.prepare(
      "INSERT INTO shops (id, shop_domain, access_token, join_secret, status, installed_at) VALUES (?,?,?,?,?,?)"
    ).bind("shop_2", "b.myshopify.com", "tok", "sec", "active", 1).run();
    await addTrackedProduct(env.DB, { id: "tp_1", shopId: "shop_1", shopifyVariantId: V1, shopifyProductId: P1, addedAt: 100 });

    expect(await listTrackedProducts(env.DB, "shop_2")).toEqual([]);

    // A cross-shop remove must not reach into another shop's rows.
    await removeTrackedProduct(env.DB, "shop_2", V1);
    expect(await listTrackedProducts(env.DB, "shop_1")).toHaveLength(1);
  });
});
