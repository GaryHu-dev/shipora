import { Hono } from "hono";
import type { Env } from "../types";
import { requireSession, type AppVars } from "../auth/session";
import { listOrders } from "../db/orders";

export const orderRoutes = new Hono<{ Bindings: Env; Variables: AppVars }>();

orderRoutes.get("/orders", requireSession(), async (c) => {
  const raw = c.req.query("status");
  const status = raw === "fulfilled" || raw === "all" ? raw : "unfulfilled";
  const q = c.req.query("q") || undefined;
  const orders = await listOrders(c.env.DB, c.get("shopId"), { status, q });
  return c.json({ orders });
});
