import { describe, it, expect } from "vitest";
import { resizeImage } from "../src/lib/image";

describe("resizeImage", () => {
  it("is a function", () => {
    expect(typeof resizeImage).toBe("function");
  });

  it("rejects when the blob is not a decodable image", async () => {
    await expect(resizeImage(new Blob(["not-an-image"], { type: "text/plain" }), 100, 0.7)).rejects.toBeTruthy();
  });
});
