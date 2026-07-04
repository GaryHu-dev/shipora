import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { putPhoto, getPhoto } from "../src/r2";

describe("r2 helper", () => {
  it("stores and retrieves bytes", async () => {
    const bytes = new TextEncoder().encode("hello-photo").buffer as ArrayBuffer;
    await putPhoto(env.PHOTOS, "shop_a/o1/p1.jpg", bytes, "image/jpeg");
    const obj = await getPhoto(env.PHOTOS, "shop_a/o1/p1.jpg");
    expect(obj).not.toBeNull();
    expect(await obj!.text()).toBe("hello-photo");
  });

  it("returns null for a missing key", async () => {
    expect(await getPhoto(env.PHOTOS, "nope")).toBeNull();
  });
});
