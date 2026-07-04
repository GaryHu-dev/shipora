import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types";
import { installRoutes } from "./routes/install";
import { webhookRoutes } from "./routes/webhooks";
import { joinRoutes } from "./routes/join";
import { orderRoutes } from "./routes/orders";
import { photoRoutes } from "./routes/photos";

const app = new Hono<{ Bindings: Env }>();

app.use("/api/*", cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"], allowHeaders: ["Authorization", "Content-Type"] }));

app.get("/health", (c) => c.json({ ok: true }));
app.route("/", installRoutes);
app.route("/", webhookRoutes);
app.route("/api", joinRoutes);
app.route("/api", orderRoutes);
app.route("/api", photoRoutes);

export default app;
