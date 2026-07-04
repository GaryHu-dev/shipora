import { describe, it, expect } from "vitest";
import { signToken, verifyToken } from "../src/auth/tokens";

const SECRET = "test-secret";
const NOW = 1_000_000;

describe("tokens", () => {
  it("round-trips a payload", async () => {
    const token = await signToken({ sub: "user_1", shop_id: "shop_1" }, SECRET, 3600, NOW);
    const payload = await verifyToken(token, SECRET, NOW);
    expect(payload).toMatchObject({ sub: "user_1", shop_id: "shop_1" });
  });

  it("rejects a tampered token", async () => {
    const token = await signToken({ sub: "user_1" }, SECRET, 3600, NOW);
    const tampered = token.slice(0, -2) + (token.endsWith("a") ? "bb" : "aa");
    expect(await verifyToken(tampered, SECRET, NOW)).toBeNull();
  });

  it("rejects a wrong secret", async () => {
    const token = await signToken({ sub: "user_1" }, SECRET, 3600, NOW);
    expect(await verifyToken(token, "other-secret", NOW)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const token = await signToken({ sub: "user_1" }, SECRET, 3600, NOW);
    expect(await verifyToken(token, SECRET, NOW + 3601)).toBeNull();
  });
});
