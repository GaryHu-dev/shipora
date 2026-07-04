import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import app from "../src/index";
import { createShop } from "../src/db/shops";
import { makeJoinToken } from "../src/routes/join";
import { verifyToken } from "../src/auth/tokens";

function now() {
  return Math.floor(Date.now() / 1000);
}

async function post(body: unknown) {
  return app.request("/api/join", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }, env);
}

describe("POST /api/join", () => {
  it("creates a user and returns a usable session", async () => {
    await createShop(env.DB, { id: "jshop", shopDomain: "j.myshopify.com", accessToken: "t", joinSecret: "j", installedAt: 1 });
    const joinToken = await makeJoinToken(env.APP_SECRET, "jshop", now());
    const res = await post({ joinToken, name: "Wang" });
    expect(res.status).toBe(200);
    const data = await res.json<{ sessionToken: string; user: { id: string; name: string } }>();
    expect(data.user.name).toBe("Wang");
    const session = await verifyToken(data.sessionToken, env.APP_SECRET, now());
    expect(session).toMatchObject({ sub: data.user.id, shop_id: "jshop" });
  });

  it("400 when name is missing", async () => {
    await createShop(env.DB, { id: "jshop2", shopDomain: "j2.myshopify.com", accessToken: "t", joinSecret: "j", installedAt: 1 });
    const joinToken = await makeJoinToken(env.APP_SECRET, "jshop2", now());
    const res = await post({ joinToken });
    expect(res.status).toBe(400);
  });

  it("401 for a garbage join token", async () => {
    const res = await post({ joinToken: "not.a.token", name: "X" });
    expect(res.status).toBe(401);
  });

  it("401 when the shop does not exist", async () => {
    const joinToken = await makeJoinToken(env.APP_SECRET, "ghost_shop", now());
    const res = await post({ joinToken, name: "X" });
    expect(res.status).toBe(401);
  });
});
