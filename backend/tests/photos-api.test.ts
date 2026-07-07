import { env, fetchMock } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import { app } from "../src/index";

// The upload route now makes a best-effort Shopify tag call. Block outbound
// network so that call fails fast and is swallowed by the route's try/catch.
beforeAll(() => { fetchMock.activate(); fetchMock.disableNetConnect(); });
import { createShop } from "../src/db/shops";
import { createUser } from "../src/db/users";
import { upsertOrder } from "../src/db/orders";
import { createPhoto } from "../src/db/photos";
import { issueSession } from "../src/auth/session";

function now() {
  return Math.floor(Date.now() / 1000);
}

async function seed() {
  await createShop(env.DB, { id: "P", shopDomain: "p.myshopify.com", accessToken: "t", joinSecret: "j", installedAt: 1 });
  await createShop(env.DB, { id: "Q", shopDomain: "q.myshopify.com", accessToken: "t", joinSecret: "j", installedAt: 1 });
  await createUser(env.DB, { id: "up", shopId: "P", name: "P-staff", joinedAt: 1 });
  await upsertOrder(env.DB, { id: "po", shopId: "P", shopifyOrderId: "gid://po", orderNumber: "#PO", customerName: "Pat", fulfillmentStatus: "unfulfilled", createdAt: 1, syncedAt: 1 });
  await upsertOrder(env.DB, { id: "qo", shopId: "Q", shopifyOrderId: "gid://qo", orderNumber: "#QO", customerName: "Qi", fulfillmentStatus: "unfulfilled", createdAt: 1, syncedAt: 1 });
  return issueSession(env.APP_SECRET, { userId: "up", shopId: "P" }, now());
}

function form(bytes: string, note?: string): FormData {
  const fd = new FormData();
  fd.set("photo", new File([bytes], "p.jpg", { type: "image/jpeg" }));
  if (note) fd.set("note", note);
  return fd;
}

describe("photos API", () => {
  it("uploads (with a category), lists a timeline, and serves a photo", async () => {
    const token = await seed();
    const fd = form("PHOTO-BYTES", "packed");
    fd.set("category", "packing_slip");
    const up = await app.request("/api/orders/po/photos", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd }, env);
    expect(up.status).toBe(200);
    const { photo } = await up.json<{ photo: { id: string } }>();

    const list = await app.request("/api/orders/po/photos", { headers: { Authorization: `Bearer ${token}` } }, env);
    const { photos } = await list.json<{ photos: { id: string; note: string | null; category: string; content_type: string | null; uploaded_by_name: string }[] }>();
    expect(photos.map((p) => p.id)).toEqual([photo.id]);
    expect(photos[0].note).toBe("packed");
    expect(photos[0].category).toBe("packing_slip");
    expect(photos[0].content_type).toBe("image/jpeg");
    expect(photos[0].uploaded_by_name).toBe("P-staff");

    const raw = await app.request(`/api/photos/${photo.id}/raw`, { headers: { Authorization: `Bearer ${token}` } }, env);
    expect(raw.status).toBe(200);
    expect(await raw.text()).toBe("PHOTO-BYTES");
  });

  it("404 when uploading to another shop's order (isolation)", async () => {
    const token = await seed();
    const res = await app.request("/api/orders/qo/photos", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form("X") }, env);
    expect(res.status).toBe(404);
  });

  it("400 when photo field is missing", async () => {
    const token = await seed();
    const res = await app.request("/api/orders/po/photos", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: new FormData() }, env);
    expect(res.status).toBe(400);
  });

  it("deletes a photo", async () => {
    const token = await seed();
    await createPhoto(env.DB, { id: "delme", shopId: "P", orderId: "po", uploadedBy: "up", r2Key: "P/po/delme.jpg", thumbKey: null, note: null, uploadedAt: 1 });
    const del = await app.request("/api/photos/delme", { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }, env);
    expect(del.status).toBe(200);
    const after = await app.request("/api/orders/po/photos", { headers: { Authorization: `Bearer ${token}` } }, env);
    const { photos } = await after.json<{ photos: { id: string }[] }>();
    expect(photos.find((p) => p.id === "delme")).toBeUndefined();
  });

  it("404 deleting another shop's photo", async () => {
    const token = await seed();
    await createPhoto(env.DB, { id: "other", shopId: "Q", orderId: "qo", uploadedBy: "up", r2Key: "Q/qo/other.jpg", thumbKey: null, note: null, uploadedAt: 1 });
    const del = await app.request("/api/photos/other", { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }, env);
    expect(del.status).toBe(404);
  });
});
