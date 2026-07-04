import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { createShop, getShopById } from "../src/db/shops";
import { createUser, getUserById } from "../src/db/users";

describe("shops & users db", () => {
  it("creates and reads a shop", async () => {
    await createShop(env.DB, {
      id: "shop_a", shopDomain: "a.myshopify.com", accessToken: "tok",
      joinSecret: "jsec", installedAt: 100,
    });
    const shop = await getShopById(env.DB, "shop_a");
    expect(shop).toMatchObject({ id: "shop_a", shop_domain: "a.myshopify.com", status: "active" });
  });

  it("returns null for a missing shop", async () => {
    expect(await getShopById(env.DB, "nope")).toBeNull();
  });

  it("creates and reads a user", async () => {
    await createShop(env.DB, {
      id: "shop_b", shopDomain: "b.myshopify.com", accessToken: "tok",
      joinSecret: "jsec", installedAt: 100,
    });
    await createUser(env.DB, { id: "user_1", shopId: "shop_b", name: "Li", joinedAt: 200 });
    const user = await getUserById(env.DB, "user_1");
    expect(user).toMatchObject({ id: "user_1", shop_id: "shop_b", name: "Li", email: null });
  });
});
