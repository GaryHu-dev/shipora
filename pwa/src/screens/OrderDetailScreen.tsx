import { useEffect, useRef, useState } from "react";
import { getOrder, listPhotos, uploadPhoto, fetchPhotoBlob, deletePhoto } from "../api/client";
import type { Photo, OrderDetail, ShippingAddress } from "../api/types";
import { resizeImage } from "../lib/image";
import { getSession } from "../auth/session";
import "./OrderDetailScreen.css";

const CATEGORIES: { key: string; label: string }[] = [
  { key: "shipping_photo", label: "Shipping photo" },
  { key: "packing_slip", label: "Packing slip" },
  { key: "shipping_label", label: "Shipping label" },
  { key: "damage", label: "Damage" },
  { key: "document", label: "Document" },
  { key: "other", label: "Other" },
];
const CAT_LABEL: Record<string, string> = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label]));

function ago(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function AddressBlock({ a }: { a: ShippingAddress }) {
  return (
    <div className="addr">
      {a.name && <div>{a.name}</div>}
      {a.address1 && <div>{a.address1}</div>}
      {a.address2 && <div>{a.address2}</div>}
      <div>{[a.city, a.province, a.zip].filter(Boolean).join(", ")}</div>
      {a.country && <div>{a.country}</div>}
      {a.phone && <div className="addr-ph">{a.phone}</div>}
    </div>
  );
}

function sameAddr(a?: ShippingAddress | null, b?: ShippingAddress | null): boolean {
  if (!a || !b) return false;
  return a.name === b.name && a.address1 === b.address1 && a.city === b.city && a.zip === b.zip;
}

function Lightbox({ url, onClose }: { url: string; onClose: () => void }) {
  const [rot, setRot] = useState(0);
  return (
    <div className="lightbox" onClick={onClose}>
      <div className="lb-bar" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => setRot((r) => r - 90)} aria-label="Rotate left">↺</button>
        <button onClick={() => setRot((r) => r + 90)} aria-label="Rotate right">↻</button>
        <button className="lb-close" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <img className="lb-img" src={url} alt="" style={{ transform: `rotate(${rot}deg)` }} onClick={(e) => e.stopPropagation()} />
    </div>
  );
}

const REVEAL = 84;

function TimelineRow({ label, sub, url, onView, onDelete }: {
  label: string; sub: string; url: string | undefined; onView: () => void; onDelete: () => void;
}) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startX = useRef<number | null>(null);
  const baseX = useRef(0);
  const moved = useRef(false);

  function down(e: React.PointerEvent) {
    startX.current = e.clientX; baseX.current = dx; moved.current = false; setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  function move(e: React.PointerEvent) {
    if (startX.current == null) return;
    const d = e.clientX - startX.current;
    if (Math.abs(d) > 4) moved.current = true;
    setDx(Math.min(0, Math.max(-REVEAL, baseX.current + d)));
  }
  function up() {
    if (startX.current == null) return;
    startX.current = null; setDragging(false);
    setDx((cur) => (cur < -REVEAL / 2 ? -REVEAL : 0));
  }
  function onClickItem() {
    if (moved.current) return;
    if (dx !== 0) { setDx(0); return; }
    onView();
  }

  return (
    <li className="tl-row">
      <button className="tl-del-bg" onClick={onDelete}>Delete</button>
      <div
        className="tl-card"
        style={{ transform: `translateX(${dx}px)`, transition: dragging ? "none" : undefined }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onClick={onClickItem}
      >
        <img className="tl-thumb" src={url || undefined} alt={label} />
        <div className="tl-body">
          <div className="tl-cat">{label}</div>
          <div className="tl-sub">{sub}</div>
        </div>
      </div>
    </li>
  );
}

export default function OrderDetailScreen({ orderId, onBack }: { orderId: string; onBack: () => void }) {
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [category, setCategory] = useState("shipping_photo");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ id: string; file: File; url: string; rot: number }[]>([]);
  const [lightbox, setLightbox] = useState<string | null>(null);

  useEffect(() => {
    const token = getSession()?.token;
    if (!token) return;
    getOrder(token, orderId).then(setDetail).catch(() => setDetail(null));
  }, [orderId]);

  async function reload() {
    const token = getSession()?.token;
    if (!token) return;
    const list = await listPhotos(token, orderId);
    setPhotos(list);
    const entries = await Promise.all(
      list.map(async (p) => {
        try {
          const blob = await fetchPhotoBlob(token, p.id);
          return [p.id, URL.createObjectURL(blob)] as const;
        } catch {
          return [p.id, ""] as const;
        }
      })
    );
    setUrls(Object.fromEntries(entries));
  }

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [orderId]);

  async function onDelete(id: string) {
    const token = getSession()?.token;
    if (!token) return;
    if (!window.confirm("Delete this photo?")) return;
    try {
      await deletePhoto(token, id);
      await reload();
    } catch { /* ignore */ }
  }

  // Stage selected photos; they are only sent when the user taps Upload.
  function addFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (files && files.length) {
      const add = Array.from(files).map((file) => ({ id: `${Date.now()}-${Math.random()}`, file, url: URL.createObjectURL(file), rot: 0 }));
      setPending((p) => [...p, ...add]);
    }
    e.target.value = "";
  }

  function rotatePending(id: string) {
    setPending((p) => p.map((x) => (x.id === id ? { ...x, rot: (x.rot + 90) % 360 } : x)));
  }

  function removePending(id: string) {
    setPending((p) => {
      const f = p.find((x) => x.id === id);
      if (f) URL.revokeObjectURL(f.url);
      return p.filter((x) => x.id !== id);
    });
  }

  function clearPending() {
    setPending((p) => { p.forEach((x) => URL.revokeObjectURL(x.url)); return []; });
  }

  async function uploadAll() {
    const token = getSession()?.token;
    if (!token || pending.length === 0) return;
    setBusy(true);
    try {
      for (const item of pending) {
        const original = await resizeImage(item.file, 1600, 0.8, item.rot);
        const thumb = await resizeImage(item.file, 320, 0.6, item.rot);
        await uploadPhoto(token, orderId, original, thumb, category, undefined);
        URL.revokeObjectURL(item.url);
      }
      setPending([]);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="detail">
      <div className="top">
        <button className="back" onClick={onBack}>Back</button>
        <h1>{detail?.order.order_number ?? "Order"}</h1>
      </div>

      {!detail && (
        <div className="detail-skel">
          <div className="skeleton" style={{ width: "50%", height: 22, borderRadius: 999 }} />
          <div className="skeleton" style={{ width: "100%", height: 96, borderRadius: "var(--radius)", marginTop: 14 }} />
        </div>
      )}

      {detail && (
        <div className="ord-info fade-in">
          <span className={`badge ${detail.order.fulfillment_status === "fulfilled" ? "badge-fulfilled" : "badge-unfulfilled"}`}>
            {detail.order.fulfillment_status === "fulfilled" ? "Fulfilled" : "Unfulfilled"}
          </span>
          {detail.order.customer_name && <span className="cust">{detail.order.customer_name}</span>}
          <span className="date">{new Date(detail.order.created_at * 1000).toLocaleDateString()}</span>
        </div>
      )}

      {detail && detail.items.length > 0 && (
        <div className="items">
          <div className="items-h">Items to pack</div>
          <ul>
            {detail.items.map((it, i) => (
              <li key={i}>
                {it.imageUrl ? (
                  <img className="it-img" src={it.imageUrl} alt="" onClick={() => setLightbox(it.imageUrl!)} />
                ) : (
                  <span className="it-img ph" aria-hidden="true" />
                )}
                <span className="qty">{it.quantity}×</span>
                <div className="it-info">
                  <span className="it-title">{it.title}</span>
                  {it.sku && <span className="it-sku">SKU: {it.sku}</span>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {detail && detail.pickup && (
        <div className="items ship-addr">
          <div className="items-h">Fulfillment</div>
          <div className="addr"><span className="badge badge-pickup">🏬 Local pickup</span></div>
        </div>
      )}
      {detail && detail.address && (
        <div className="items ship-addr">
          <div className="items-h">Ship to</div>
          <AddressBlock a={detail.address} />
        </div>
      )}
      {detail && detail.billing && !sameAddr(detail.address, detail.billing) && (
        <div className="items ship-addr">
          <div className="items-h">Billing address</div>
          <AddressBlock a={detail.billing} />
        </div>
      )}

      <div className="cat-label">Photo type</div>
      <div className="cat-row">
        {CATEGORIES.map((c) => (
          <button key={c.key} className={`chip${category === c.key ? " on" : ""}`} onClick={() => setCategory(c.key)}>{c.label}</button>
        ))}
      </div>

      <div className="add-row">
        <label className={`add-btn${busy ? " busy" : ""}`}>
          <span className="big" aria-hidden="true">📷</span>
          <span>Take photo</span>
          <input type="file" accept="image/*" capture="environment" onChange={addFiles} disabled={busy} />
        </label>
        <label className={`add-btn${busy ? " busy" : ""}`}>
          <span className="big" aria-hidden="true">🖼️</span>
          <span>From library</span>
          <input type="file" accept="image/*" multiple onChange={addFiles} disabled={busy} />
        </label>
      </div>

      {pending.length > 0 && (
        <div className="pending">
          <div className="items-h">Ready to upload · {pending.length}</div>
          <div className="pend-grid">
            {pending.map((p) => (
              <div key={p.id} className="pend-item">
                <img src={p.url} alt="" style={{ transform: `rotate(${p.rot}deg)` }} onClick={() => setLightbox(p.url)} />
                {!busy && <button className="pend-x" onClick={() => removePending(p.id)} aria-label="Remove">×</button>}
                {!busy && <button className="pend-rot" onClick={() => rotatePending(p.id)} aria-label="Rotate">↻</button>}
              </div>
            ))}
          </div>
          <div className="pend-actions">
            <button className="btn" onClick={uploadAll} disabled={busy}>
              {busy ? "Uploading…" : `Upload ${pending.length} photo${pending.length > 1 ? "s" : ""}`}
            </button>
            <button className="pend-clear" onClick={clearPending} disabled={busy}>Clear</button>
          </div>
        </div>
      )}

      {photos.length === 0 && <p className="status">No proof photos yet — add one above</p>}
      {photos.length > 0 && <div className="items-h photos-h">Proof of shipment · {photos.length}</div>}
      {photos.length > 0 && <p className="tl-hint">Tap to view · swipe left to delete</p>}
      <ul className="timeline">
        {photos.map((p) => (
          <TimelineRow
            key={p.id}
            label={CAT_LABEL[p.category] || p.category}
            sub={`by ${p.uploaded_by_name} · ${ago(p.uploaded_at)}`}
            url={urls[p.id]}
            onView={() => { const u = urls[p.id]; if (u) setLightbox(u); }}
            onDelete={() => onDelete(p.id)}
          />
        ))}
      </ul>

      {lightbox && <Lightbox url={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}
