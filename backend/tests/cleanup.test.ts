import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { createShop } from "../src/db/shops";
import { createUser } from "../src/db/users";
import { upsertOrder } from "../src/db/orders";
import { createPhoto, listPhotosByOrder } from "../src/db/photos";
import { deleteExpiredPhotos } from "../src/cleanup";

// Note: R2 object removal is exercised in r2.test.ts. Here we assert the D1
// side (which photos get removed) to avoid the vitest-pool-workers isolated-
// storage teardown quirk with R2 deletes. deleteExpiredPhotos calls
// PHOTOS.delete on keys that don't exist here — a harmless no-op.
describe("deleteExpiredPhotos", () => {
  it("removes photos older than retention, keeps recent ones", async () => {
    await createShop(env.DB, { id: "cs", shopDomain: "cs.myshopify.com", accessToken: "t", joinSecret: "j", installedAt: 1 });
    await createUser(env.DB, { id: "cu", shopId: "cs", name: "C", joinedAt: 1 });
    await upsertOrder(env.DB, { id: "co", shopId: "cs", shopifyOrderId: "gid://c", orderNumber: "#C", customerName: null, fulfillmentStatus: "unfulfilled", createdAt: 1, syncedAt: 1 });

    const now = 100 * 24 * 60 * 60;              // day 100
    const oldAt = now - 40 * 24 * 60 * 60;       // 40 days ago → expired at 30d
    const newAt = now - 5 * 24 * 60 * 60;        // 5 days ago → kept

    await createPhoto(env.DB, { id: "p_old", shopId: "cs", orderId: "co", uploadedBy: "cu", r2Key: "cs/co/old.jpg", thumbKey: null, note: null, uploadedAt: oldAt });
    await createPhoto(env.DB, { id: "p_new", shopId: "cs", orderId: "co", uploadedBy: "cu", r2Key: "cs/co/new.jpg", thumbKey: null, note: null, uploadedAt: newAt });

    const deleted = await deleteExpiredPhotos(env, "cs", 30, now);
    expect(deleted).toBe(1);

    const remaining = await listPhotosByOrder(env.DB, "cs", "co");
    expect(remaining.map((p) => p.id)).toEqual(["p_new"]);
  });
});
