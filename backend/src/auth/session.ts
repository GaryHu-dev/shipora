import type { Context, MiddlewareHandler } from "hono";
import type { Env } from "../types";
import { signToken, verifyToken } from "./tokens";
import { getUserById } from "../db/users";

export type AppVars = { userId: string; shopId: string };

const SESSION_TTL = 60 * 60 * 24 * 180; // 180 days

export async function issueSession(
  secret: string,
  claims: { userId: string; shopId: string },
  nowSeconds: number
): Promise<string> {
  return signToken({ sub: claims.userId, shop_id: claims.shopId }, secret, SESSION_TTL, nowSeconds);
}

export function requireSession(): MiddlewareHandler<{ Bindings: Env; Variables: AppVars }> {
  return async (c: Context<{ Bindings: Env; Variables: AppVars }>, next) => {
    const header = c.req.header("Authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return c.json({ error: "unauthorized" }, 401);

    const now = Math.floor(Date.now() / 1000);
    const payload = await verifyToken(token, c.env.APP_SECRET, now);
    if (!payload || typeof payload.sub !== "string" || typeof payload.shop_id !== "string") {
      return c.json({ error: "unauthorized" }, 401);
    }

    const user = await getUserById(c.env.DB, payload.sub);
    if (!user || user.shop_id !== payload.shop_id) {
      return c.json({ error: "unauthorized" }, 401);
    }

    c.set("userId", user.id);
    c.set("shopId", user.shop_id);
    await next();
  };
}
