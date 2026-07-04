import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join, listOrders, uploadPhoto, ApiError } from "../src/api/client";

const base = import.meta.env.VITE_API_BASE;

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

function mockFetch(status: number, body: unknown) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
  );
}

describe("api client", () => {
  it("join posts token + name", async () => {
    const f = mockFetch(200, { sessionToken: "s", user: { id: "u", name: "Li" } });
    const out = await join("jt", "Li");
    expect(out.sessionToken).toBe("s");
    expect(f).toHaveBeenCalledWith(`${base}/api/join`, expect.objectContaining({ method: "POST" }));
  });

  it("listOrders passes status and bearer token", async () => {
    const f = mockFetch(200, { orders: [{ id: "o1", order_number: "#1", customer_name: null, fulfillment_status: "unfulfilled", created_at: 1 }] });
    const orders = await listOrders("tok", "unfulfilled");
    expect(orders).toHaveLength(1);
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toBe(`${base}/api/orders?status=unfulfilled`);
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer tok" });
  });

  it("uploadPhoto sends multipart with photo + thumb", async () => {
    const f = mockFetch(200, { photo: { id: "p" } });
    await uploadPhoto("tok", "o1", new Blob(["a"]), new Blob(["b"]), "packed");
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toBe(`${base}/api/orders/o1/photos`);
    expect((init as RequestInit).body).toBeInstanceOf(FormData);
  });

  it("throws ApiError with status on failure", async () => {
    mockFetch(401, { error: "unauthorized" });
    await expect(listOrders("bad", "all")).rejects.toMatchObject({ status: 401 });
    expect(new ApiError(500, "x")).toBeInstanceOf(Error);
  });
});
