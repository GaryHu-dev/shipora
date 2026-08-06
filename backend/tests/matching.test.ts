import { describe, it, expect } from "vitest";
import { scoreTitleMatch, pickBestMatch, FUZZY_MATCH_THRESHOLD } from "../src/purchaseOrders/matching";

describe("scoreTitleMatch", () => {
  it("scores 1 for an exact token match", () => {
    expect(scoreTitleMatch("ACME FULL CREAM MILK 12X1L", "ACME FULL CREAM MILK 12X1L")).toBe(1);
  });

  it("scores partial overlap between 0 and 1", () => {
    const score = scoreTitleMatch("ACME FULL CREAM MILK 12X1L", "ACME FULL CREAM MILK 24X1L");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("scores 0 for completely unrelated strings", () => {
    expect(scoreTitleMatch("ACME BUTTER SALTED", "XYZ ORANGE JUICE")).toBe(0);
  });

  it("is case-insensitive", () => {
    expect(scoreTitleMatch("acme milk", "ACME MILK")).toBe(1);
  });

  it("returns 0 for an empty string on either side", () => {
    expect(scoreTitleMatch("", "ACME MILK")).toBe(0);
    expect(scoreTitleMatch("ACME MILK", "")).toBe(0);
  });
});

describe("pickBestMatch", () => {
  const candidates = [
    { id: "gid://1", sku: "A1", title: "ACME FULL CREAM MILK 12X1L" },
    { id: "gid://2", sku: "A2", title: "ACME LOW FAT MILK 12X1L" },
    { id: "gid://3", sku: "A3", title: "XYZ ORANGE JUICE 6X1L" },
  ];

  it("picks the highest-scoring candidate above the threshold", () => {
    const best = pickBestMatch("ACME FULL CREAM MILK 12X1L", candidates);
    expect(best?.id).toBe("gid://1");
    expect(best?.score).toBeGreaterThanOrEqual(FUZZY_MATCH_THRESHOLD);
  });

  it("returns null when nothing clears the threshold", () => {
    expect(pickBestMatch("COMPLETELY DIFFERENT PRODUCT NAME", candidates)).toBeNull();
  });

  it("returns null for an empty candidate list", () => {
    expect(pickBestMatch("ACME MILK", [])).toBeNull();
  });
});
