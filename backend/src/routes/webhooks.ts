import { Hono } from "hono";
import type { Env } from "../types";
import { verifyWebhookHmac } from "../shopify/hmac";
import { upsertOrder } from "../db/orders";
import { newId } from "../ids";

export const webhookRoutes = new Hono<{ Bindings: Env }>();

interface OrderWebhook {
  admin_graphql_api_id: string;
  name: string;
  created_at: string;
  fulfillment_status: string | null;
  customer?: { first_name?: string | null; last_name?: string | null } | null;
}

function customerName(c: OrderWebhook["customer"]): string | null {
  if (!c) return null;
  const full = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
  return full || null;
}

webhookRoutes.post("/webhooks/:topic{.+}", async (c) => {
  const topic = c.req.param("topic");
  const raw = await c.req.arrayBuffer();
  const hmacHeader = c.req.header("X-Shopify-Hmac-Sha256") ?? "";
  if (!(await verifyWebhookHmac(raw, hmacHeader, c.env.SHOPIFY_API_SECRET))) {
    return c.json({ error: "bad hmac" }, 401);
  }

  const shopDomain = c.req.header("X-Shopify-Shop-Domain") ?? "";
  const shop = await c.env.DB.prepare("SELECT id FROM shops WHERE shop_domain = ?").bind(shopDomain).first<{ id: string }>();
  if (!shop) return c.body(null, 200); // unknown shop: ack so Shopify stops retrying

  const payload = JSON.parse(new TextDecoder().decode(raw));
  const now = Math.floor(Date.now() / 1000);

  if (topic === "orders/create" || topic === "orders/updated") {
    const o = payload as OrderWebhook;
    await upsertOrder(c.env.DB, {
      id: newId("order"),
      shopId: shop.id,
      shopifyOrderId: o.admin_graphql_api_id,
      orderNumber: o.name,
      customerName: customerName(o.customer),
      fulfillmentStatus: o.fulfillment_status === "fulfilled" ? "fulfilled" : "unfulfilled",
      createdAt: Math.floor(Date.parse(o.created_at) / 1000),
      syncedAt: now,
    });
  } else if (topic === "app/uninstalled") {
    await c.env.DB.prepare("UPDATE shops SET status = 'uninstalled' WHERE id = ?").bind(shop.id).run();
  }

  return c.body(null, 200);
});
