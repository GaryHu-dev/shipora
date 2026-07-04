import { useEffect, useState } from "react";
import { listOrders } from "../api/client";
import type { Order, OrderStatus } from "../api/types";
import { getSession } from "../auth/session";
import "./OrdersScreen.css";

const TABS: { key: OrderStatus; label: string }[] = [
  { key: "unfulfilled", label: "未发货" },
  { key: "all", label: "全部" },
  { key: "fulfilled", label: "已发货" },
];

export default function OrdersScreen({ onOpenOrder }: { onOpenOrder: (id: string) => void }) {
  const [status, setStatus] = useState<OrderStatus>("unfulfilled");
  const [q, setQ] = useState("");
  const [orders, setOrders] = useState<Order[] | null>(null);

  useEffect(() => {
    const token = getSession()?.token;
    if (!token) return;
    let active = true;
    setOrders(null);
    const handle = setTimeout(() => {
      listOrders(token, status, q.trim() || undefined)
        .then((rows) => { if (active) setOrders(rows); })
        .catch(() => { if (active) setOrders([]); });
    }, q ? 250 : 0);
    return () => { active = false; clearTimeout(handle); };
  }, [status, q]);

  return (
    <div className="orders">
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.key} aria-pressed={status === t.key} onClick={() => setStatus(t.key)}>{t.label}</button>
        ))}
      </div>
      <input className="search" placeholder="搜索订单号或客户名" value={q} onChange={(e) => setQ(e.target.value)} />
      {orders === null && <div className="loading">加载中…</div>}
      {orders !== null && orders.length === 0 && <div className="empty">没有订单</div>}
      {orders?.map((o) => (
        <div key={o.id} className="row" onClick={() => onOpenOrder(o.id)}>
          <div className="num">{o.order_number}</div>
          <div className="meta">
            <span className="cust">{o.customer_name ?? "—"}</span>
            {" · "}
            <span className="stat">{o.fulfillment_status === "fulfilled" ? "已发货" : "未发货"}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
