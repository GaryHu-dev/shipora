import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { createShop } from "../src/db/shops";
import { createUser } from "../src/db/users";
import { upsertOrder } from "../src/db/orders";
import { createPhoto, listPhotosByOrder } from "../src/db/photos";

async function seed() {
  await createShop(env.DB, { id: "sp", shopDomain: "sp.myshopify.com", accessToken: "t", joinSecret: "j", installedAt: 1 });
  await createUser(env.DB, { id: "u", shopId: "sp", name: "Li", joinedAt: 1 });
  await upsertOrder(env.DB, { id: "op", shopId: "sp", shopifyOrderId: "gid://9", orderNumber: "#9", customerName: "Zed", fulfillmentStatus: "unfulfilled", createdAt: 1, syncedAt: 1 });
}

describe("photos db", () => {
  it("creates and lists photos for an order", async () => {
    await seed();
    await createPhoto(env.DB, { id: "ph1", shopId: "sp", orderId: "op", uploadedBy: "u", r2Key: "sp/op/ph1.jpg", thumbKey: "sp/op/ph1_t.jpg", note: null, uploadedAt: 5 });
    const rows = await listPhotosByOrder(env.DB, "sp", "op");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "ph1", order_id: "op", uploaded_by: "u", r2_key: "sp/op/ph1.jpg" });
  });
});
