import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { app } from "../src/index";

describe("CORS on /api", () => {
  it("answers preflight with permissive headers", async () => {
    const res = await app.request("/api/orders", {
      method: "OPTIONS",
      headers: { Origin: "https://pwa.example", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization" },
    }, env);
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("adds allow-origin to an actual API response", async () => {
    const res = await app.request("/api/orders", { headers: { Origin: "https://pwa.example" } }, env);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});
