import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { listOrders } from "../api/client";
import type { Order, OrderStatus } from "../api/types";
import { getSession } from "../auth/session";
import "./OrdersScreen.css";

const TABS: { key: OrderStatus; label: string }[] = [
  { key: "unfulfilled", label: "Unfulfilled" },
  { key: "all", label: "All" },
  { key: "fulfilled", label: "Fulfilled" },
];

const PAGE = 20;

// Module-level cache: returning from an order detail restores the same tab,
// scroll position and already-loaded orders without a refetch.
let cache: {
  status: OrderStatus; q: string; orders: Order[];
  offset: number; hasMore: boolean; scrollY: number;
} | null = null;

export function resetOrdersCache() { cache = null; }

export default function OrdersScreen({ onOpenOrder }: { onOpenOrder: (id: string) => void }) {
  const [status, setStatus] = useState<OrderStatus>(cache?.status ?? "unfulfilled");
  const [q, setQ] = useState(cache?.q ?? "");
  const [orders, setOrders] = useState<Order[] | null>(cache?.orders ?? null);
  const [offset, setOffset] = useState(cache?.offset ?? 0);
  const [hasMore, setHasMore] = useState(cache?.hasMore ?? true);
  const [refreshing, setRefreshing] = useState(false);
  // A failed load used to fall through to the same empty list as "this shop has
  // no orders in this view". The two need to look different: one is a fact, the
  // other is a problem the person can act on.
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pull, setPull] = useState(0);
  const restored = useRef(cache != null);
  const sentinel = useRef<HTMLDivElement | null>(null);

  const loadFirst = useCallback(async (silent: boolean) => {
    const token = getSession()?.token;
    if (!token) return;
    if (silent) setRefreshing(true); else setOrders(null);
    try {
      const rows = await listOrders(token, status, q.trim() || undefined, PAGE, 0);
      setOrders(rows);
      setOffset(rows.length);
      setHasMore(rows.length === PAGE);
      setLoadFailed(false);
    } catch {
      setOrders((o) => o ?? []);
      setLoadFailed(true);
    } finally {
      setRefreshing(false);
    }
  }, [status, q]);

  const loadMore = useCallback(async () => {
    const token = getSession()?.token;
    if (!token) return;
    setLoadingMore(true);
    try {
      const rows = await listOrders(token, status, q.trim() || undefined, PAGE, offset);
      setOrders((prev) => [...(prev ?? []), ...rows]);
      setOffset((o) => o + rows.length);
      setHasMore(rows.length === PAGE);
    } finally {
      setLoadingMore(false);
    }
  }, [status, q, offset]);

  // Reload page 0 on filter/search change — but keep cached data on first mount.
  useEffect(() => {
    if (restored.current) { restored.current = false; return; }
    const h = setTimeout(() => loadFirst(false), q ? 250 : 0);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, q]);

  // Keep the cache in sync with the current state.
  useEffect(() => {
    cache = { status, q, orders: orders ?? [], offset, hasMore, scrollY: cache?.scrollY ?? 0 };
  }, [status, q, orders, offset, hasMore]);

  // Restore scroll position once, after cached orders have rendered.
  useLayoutEffect(() => {
    if (cache && orders && orders.length) window.scrollTo(0, cache.scrollY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onScroll = () => { if (cache) cache.scrollY = window.scrollY; };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Infinite scroll — load the next page when the sentinel nears the viewport.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && hasMore && !loadingMore && orders) loadMore();
    }, { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loadingMore, orders, loadMore]);

  // Silent refresh when the app returns to the foreground.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") loadFirst(true); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onVisible);
    };
  }, [loadFirst]);

  // Pull-to-refresh (only when scrolled to the top).
  const pullStart = useRef<number | null>(null);
  function onTouchStart(e: React.TouchEvent) { if (window.scrollY <= 0) pullStart.current = e.touches[0].clientY; }
  function onTouchMove(e: React.TouchEvent) {
    if (pullStart.current == null) return;
    const d = e.touches[0].clientY - pullStart.current;
    setPull(d > 0 ? Math.min(d * 0.5, 80) : 0);
  }
  function onTouchEnd() {
    if (pull > 55) loadFirst(true);
    setPull(0);
    pullStart.current = null;
  }

  return (
    <div className="orders" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      <div className="ptr" style={{ height: pull, transition: pullStart.current == null ? "height .2s ease" : "none" }}>
        {refreshing ? "Syncing…" : pull > 55 ? "Release to refresh" : pull > 0 ? "Pull to refresh" : ""}
      </div>

      <div className="orders-top">
        <span className="orders-title">Orders</span>
        <button className="refresh" onClick={() => loadFirst(true)} disabled={refreshing}>
          {refreshing ? "Syncing…" : "↻ Sync"}
        </button>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.key} aria-pressed={status === t.key} onClick={() => setStatus(t.key)}>{t.label}</button>
        ))}
      </div>
      <input className="field search" placeholder="Search order number or customer" value={q} onChange={(e) => setQ(e.target.value)} />

      {orders === null && (
        <div className="list">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="row skel-row">
              <div className="main"><div className="skeleton skel-num" /><div className="skeleton skel-cust" /></div>
              <div className="skeleton skel-badge" />
            </div>
          ))}
        </div>
      )}
      {orders !== null && orders.length === 0 && loadFailed && (
        <div className="empty">
          Couldn&apos;t load orders.{" "}
          <button className="linklike" onClick={() => loadFirst(false)}>Try again</button>
          <div className="empty-sub">If this keeps happening, sign out and scan the join code again.</div>
        </div>
      )}
      {orders !== null && orders.length === 0 && !loadFailed && (
        <div className="empty">No orders in this view</div>
      )}

      <div className="list">
        {orders?.map((o) => {
          const fulfilled = o.fulfillment_status === "fulfilled";
          return (
            <div key={o.id} className="row" onClick={() => onOpenOrder(o.id)}>
              <div className="main">
                <div className="num">{o.order_number}</div>
                <div className="cust">{o.customer_name ?? "—"}</div>
              </div>
              <span className={`badge ${fulfilled ? "badge-fulfilled" : "badge-unfulfilled"}`}>
                {fulfilled ? "Fulfilled" : "Unfulfilled"}
              </span>
              <span className="chev" aria-hidden="true">›</span>
            </div>
          );
        })}
      </div>

      <div ref={sentinel} className="sentinel" />
      {orders !== null && orders.length > 0 && hasMore && (
        <button className="load-more" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
