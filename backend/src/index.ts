import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types";
import { installRoutes } from "./routes/install";
import { webhookRoutes } from "./routes/webhooks";
import { joinRoutes } from "./routes/join";
import { orderRoutes } from "./routes/orders";
import { photoRoutes } from "./routes/photos";
import { adminRoutes } from "./routes/admin";
import { purchaseOrderRoutes } from "./routes/purchaseOrders";
import { adminPageRoutes } from "./routes/adminPage";
import { photoViewRoutes } from "./routes/photoView";
import { deleteExpiredPhotos } from "./cleanup";

export const app = new Hono<{ Bindings: Env }>();

const corsOptions = { origin: "*", allowMethods: ["GET", "POST", "DELETE", "OPTIONS"], allowHeaders: ["Authorization", "Content-Type"] };
app.use("/api/*", cors(corsOptions));
app.use("/admin/api/*", cors(corsOptions));

app.get("/health", (c) => c.json({ ok: true }));
app.route("/", installRoutes);
app.route("/", webhookRoutes);
app.route("/", adminRoutes);
app.route("/", purchaseOrderRoutes);
app.route("/", adminPageRoutes);
app.route("/", photoViewRoutes);
app.route("/api", joinRoutes);
app.route("/api", orderRoutes);
app.route("/api", photoRoutes);

// Daily scheduled cleanup: delete each active shop's photos past its retention.
async function scheduled(_event: ScheduledController, env: Env): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const { results } = await env.DB
    .prepare("SELECT id, retention_days FROM shops WHERE status = 'active'")
    .all<{ id: string; retention_days: number }>();
  for (const s of results) {
    await deleteExpiredPhotos(env, s.id, s.retention_days ?? 30, now);
  }
}

export default {
  fetch: (req: Request, env: Env, ctx: ExecutionContext) => app.fetch(req, env, ctx),
  scheduled,
};
