import { Hono } from "hono";
import type { Env } from "../types";
import { signToken, verifyToken } from "../auth/tokens";
import { issueSession } from "../auth/session";
import { getShopById } from "../db/shops";
import { createUser } from "../db/users";
import { newId } from "../ids";

const JOIN_TTL = 60 * 60 * 24 * 30; // 30 days

export async function makeJoinToken(
  secret: string,
  shopId: string,
  nowSeconds: number,
  ttlSeconds: number = JOIN_TTL
): Promise<string> {
  return signToken({ kind: "join", shop_id: shopId }, secret, ttlSeconds, nowSeconds);
}

export const joinRoutes = new Hono<{ Bindings: Env }>();

joinRoutes.post("/join", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { joinToken?: unknown; name?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const joinToken = typeof body?.joinToken === "string" ? body.joinToken : "";
  if (!name || !joinToken) return c.json({ error: "name and joinToken required" }, 400);

  const now = Math.floor(Date.now() / 1000);
  const payload = await verifyToken(joinToken, c.env.APP_SECRET, now);
  if (!payload || payload.kind !== "join" || typeof payload.shop_id !== "string") {
    return c.json({ error: "invalid join token" }, 401);
  }

  const shop = await getShopById(c.env.DB, payload.shop_id);
  if (!shop || shop.status !== "active") return c.json({ error: "invalid shop" }, 401);

  const userId = newId("user");
  await createUser(c.env.DB, { id: userId, shopId: shop.id, name, joinedAt: now });
  const sessionToken = await issueSession(c.env.APP_SECRET, { userId, shopId: shop.id }, now);

  return c.json({ sessionToken, user: { id: userId, name } });
});
