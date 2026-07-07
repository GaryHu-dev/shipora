import type { Context, MiddlewareHandler } from "hono";
import type { Env } from "../types";
import { verifyShopifySessionToken } from "../shopify/sessionToken";

export type AdminVars = { shopId: string; shopDomain: string };

export function requireAdminSession(): MiddlewareHandler<{ Bindings: Env; Variables: AdminVars }> {
  return async (c: Context<{ Bindings: Env; Variables: AdminVars }>, next) => {
    const header = c.req.header("Authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return c.json({ error: "unauthorized" }, 401);

    const now = Math.floor(Date.now() / 1000);
    const result = await verifyShopifySessionToken(token, c.env.SHOPIFY_API_KEY, c.env.SHOPIFY_API_SECRET, now);
    if (!result) return c.json({ error: "unauthorized" }, 401);

    const shop = await c.env.DB.prepare("SELECT id, status FROM shops WHERE shop_domain = ?").bind(result.shopDomain).first<{ id: string; status: string }>();
    if (!shop || shop.status !== "active") return c.json({ error: "unauthorized" }, 401);

    c.set("shopId", shop.id);
    c.set("shopDomain", result.shopDomain);
    await next();
  };
}
