import { Hono } from "hono";
import type { Env } from "../types";
import { requireSession, type AppVars } from "../auth/session";
import { listOrders, getOrderByIdForShop } from "../db/orders";
import { getShopById } from "../db/shops";
import { fetchOrderLineItems, fetchAddresses } from "../shopify/orderDetails";

export const orderRoutes = new Hono<{ Bindings: Env; Variables: AppVars }>();

// Update the signed-in staffer's display name (shown on their uploads).
orderRoutes.post("/me/name", requireSession(), async (c) => {
  const body = (await c.req.json().catch(() => null)) as { name?: unknown } | null;
  const name = (typeof body?.name === "string" ? body.name.replace(/\s+/g, " ").trim() : "").slice(0, 80);
  if (!name) return c.json({ error: "name required" }, 400);
  await c.env.DB.prepare("UPDATE users SET name = ? WHERE id = ?").bind(name, c.get("userId")).run();
  return c.json({ ok: true, name });
});

orderRoutes.get("/orders", requireSession(), async (c) => {
  const raw = c.req.query("status");
  const status = raw === "fulfilled" || raw === "all" ? raw : "unfulfilled";
  const q = c.req.query("q") || undefined;
  const limit = Number(c.req.query("limit")) || 20;
  const offset = Number(c.req.query("offset")) || 0;
  const orders = await listOrders(c.env.DB, c.get("shopId"), { status, q, limit, offset });
  return c.json({ orders });
});

orderRoutes.get("/orders/:id", requireSession(), async (c) => {
  const order = await getOrderByIdForShop(c.env.DB, c.get("shopId"), c.req.param("id"));
  if (!order) return c.json({ error: "not found" }, 404);

  const shop = await getShopById(c.env.DB, c.get("shopId"));
  let items: Awaited<ReturnType<typeof fetchOrderLineItems>> = [];
  let addresses: Awaited<ReturnType<typeof fetchAddresses>> = { shipping: null, billing: null };
  if (shop?.access_token) {
    try {
      items = await fetchOrderLineItems(shop.shop_domain, shop.access_token, order.shopify_order_id);
    } catch (err) {
      console.error("line items fetch failed", { orderId: order.id, err: String(err) });
    }
    try {
      addresses = await fetchAddresses(shop.shop_domain, shop.access_token, order.shopify_order_id);
    } catch (err) {
      console.error("addresses fetch failed", { orderId: order.id, err: String(err) });
    }
  }

  return c.json({
    order: {
      order_number: order.order_number,
      customer_name: order.customer_name,
      fulfillment_status: order.fulfillment_status,
      created_at: order.created_at,
    },
    items,
    address: addresses.shipping,
    billing: addresses.billing,
    pickup: addresses.shipping == null, // no shipping address ⇒ local pickup
  });
});
