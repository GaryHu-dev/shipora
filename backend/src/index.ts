import { Hono } from "hono";
import type { Env } from "./types";
import { joinRoutes } from "./routes/join";
import { orderRoutes } from "./routes/orders";
import { photoRoutes } from "./routes/photos";

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json({ ok: true }));
app.route("/api", joinRoutes);
app.route("/api", orderRoutes);
app.route("/api", photoRoutes);

export default app;
