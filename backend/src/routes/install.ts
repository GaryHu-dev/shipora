import { Hono } from "hono";
import type { Env } from "../types";
import { signToken, verifyToken } from "../auth/tokens";
import { verifyOAuthHmac } from "../shopify/hmac";
import { buildAuthorizeUrl, exchangeCodeForToken, isValidShopDomain } from "../shopify/oauth";
import { createShop, getShopById } from "../db/shops";
import { syncRecentOrders } from "../shopify/ordersSync";
import { registerWebhooks } from "../shopify/webhooks";
import { newId } from "../ids";

export const installRoutes = new Hono<{ Bindings: Env }>();

installRoutes.get("/auth", async (c) => {
  const shop = c.req.query("shop") ?? "";
  if (!isValidShopDomain(shop)) return c.json({ error: "invalid shop" }, 400);
  const now = Math.floor(Date.now() / 1000);
  const state = await signToken({ kind: "oauth", shop }, c.env.APP_SECRET, 600, now);
  return c.redirect(buildAuthorizeUrl(c.env, shop, state), 302);
});

installRoutes.get("/auth/callback", async (c) => {
  const url = new URL(c.req.url);
  const params = url.searchParams;
  const shop = params.get("shop") ?? "";
  const code = params.get("code") ?? "";
  const state = params.get("state") ?? "";

  if (!isValidShopDomain(shop) || !code) return c.json({ error: "bad request" }, 400);
  if (!(await verifyOAuthHmac(params, c.env.SHOPIFY_API_SECRET))) return c.json({ error: "bad hmac" }, 401);

  const now = Math.floor(Date.now() / 1000);
  const statePayload = await verifyToken(state, c.env.APP_SECRET, now);
  if (!statePayload || statePayload.kind !== "oauth" || statePayload.shop !== shop) {
    return c.json({ error: "bad state" }, 401);
  }

  const { access_token } = await exchangeCodeForToken(c.env, shop, code);

  const existing = await c.env.DB.prepare("SELECT id FROM shops WHERE shop_domain = ?").bind(shop).first<{ id: string }>();
  const shopId = existing?.id ?? newId("shop");
  if (existing) {
    await c.env.DB.prepare("UPDATE shops SET access_token = ?, status = 'active', installed_at = ? WHERE id = ?")
      .bind(access_token, now, shopId).run();
  } else {
    await createShop(c.env.DB, { id: shopId, shopDomain: shop, accessToken: access_token, joinSecret: newId("jsec"), installedAt: now });
  }

  const stored = await getShopById(c.env.DB, shopId);
  if (stored) {
    await syncRecentOrders(c.env.DB, stored, now);
    await registerWebhooks(c.env, stored);
  }

  return c.html("<h1>Shipora installed ✓</h1><p>You can close this window.</p>");
});
