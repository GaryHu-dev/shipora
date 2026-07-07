import { Hono } from "hono";
import type { Env } from "../types";
import { signToken, verifyToken, decodeUnverified } from "../auth/tokens";
import { issueSession } from "../auth/session";
import { getShopById } from "../db/shops";
import { createUser } from "../db/users";
import { newId } from "../ids";

const JOIN_TTL = 60 * 60 * 24 * 180; // 180 days

// Join tokens are signed with a per-shop key (APP_SECRET + the shop's join_secret)
// so a single shop can revoke all its outstanding QR links by rotating its
// join_secret, without affecting any other shop.
function joinKey(appSecret: string, joinSecret: string): string {
  return `${appSecret}:${joinSecret}`;
}

export async function makeJoinToken(
  appSecret: string,
  joinSecret: string,
  shopId: string,
  nowSeconds: number,
  ttlSeconds: number = JOIN_TTL
): Promise<string> {
  return signToken({ kind: "join", shop_id: shopId }, joinKey(appSecret, joinSecret), ttlSeconds, nowSeconds);
}

export const joinRoutes = new Hono<{ Bindings: Env }>();

joinRoutes.post("/join", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { joinToken?: unknown; name?: unknown } | null;
  // Collapse whitespace/newlines and cap length — the name is echoed into Shopify order notes.
  const name = (typeof body?.name === "string" ? body.name.replace(/\s+/g, " ").trim() : "").slice(0, 80);
  const joinToken = typeof body?.joinToken === "string" ? body.joinToken : "";
  if (!name || !joinToken) return c.json({ error: "name and joinToken required" }, 400);

  const now = Math.floor(Date.now() / 1000);

  // Read the target shop from the (unverified) token, load its current
  // join_secret, then verify the signature with that per-shop key.
  const claims = decodeUnverified(joinToken);
  const shopId = typeof claims?.shop_id === "string" ? claims.shop_id : "";
  const shop = shopId ? await getShopById(c.env.DB, shopId) : null;
  if (!shop || shop.status !== "active") return c.json({ error: "invalid shop" }, 401);

  const payload = await verifyToken(joinToken, joinKey(c.env.APP_SECRET, shop.join_secret), now);
  if (!payload || payload.kind !== "join" || payload.shop_id !== shop.id) {
    return c.json({ error: "invalid join token" }, 401);
  }

  const userId = newId("user");
  await createUser(c.env.DB, { id: userId, shopId: shop.id, name, joinedAt: now });
  const sessionToken = await issueSession(c.env.APP_SECRET, { userId, shopId: shop.id }, now);

  return c.json({ sessionToken, user: { id: userId, name } });
});
