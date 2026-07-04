import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { createShop } from "../src/db/shops";
import { createUser } from "../src/db/users";
import { issueSession, requireSession, type AppVars } from "../src/auth/session";
import type { Env } from "../src/types";

function testApp() {
  const app = new Hono<{ Bindings: Env; Variables: AppVars }>();
  app.get("/me", requireSession(), (c) => c.json({ userId: c.get("userId"), shopId: c.get("shopId") }));
  return app;
}

describe("requireSession", () => {
  it("401 without a token", async () => {
    const res = await testApp().request("/me", {}, env);
    expect(res.status).toBe(401);
  });

  it("passes a valid session and exposes userId/shopId", async () => {
    await createShop(env.DB, { id: "ss", shopDomain: "ss.myshopify.com", accessToken: "t", joinSecret: "j", installedAt: 1 });
    await createUser(env.DB, { id: "uu", shopId: "ss", name: "Li", joinedAt: 1 });
    const now = Math.floor(Date.now() / 1000);
    const token = await issueSession(env.APP_SECRET, { userId: "uu", shopId: "ss" }, now);
    const res = await testApp().request("/me", { headers: { Authorization: `Bearer ${token}` } }, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: "uu", shopId: "ss" });
  });

  it("401 when the user no longer exists", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await issueSession(env.APP_SECRET, { userId: "ghost", shopId: "ss" }, now);
    const res = await testApp().request("/me", { headers: { Authorization: `Bearer ${token}` } }, env);
    expect(res.status).toBe(401);
  });
});
