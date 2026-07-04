import { useEffect, useState } from "react";
import { listPhotos, uploadPhoto, photoRawUrl } from "../api/client";
import type { Photo } from "../api/types";
import { resizeImage } from "../lib/image";
import { getSession } from "../auth/session";
import "./OrderDetailScreen.css";

export default function OrderDetailScreen({ orderId, onBack }: { orderId: string; onBack: () => void }) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [busy, setBusy] = useState(false);

  async function reload() {
    const token = getSession()?.token;
    if (!token) return;
    setPhotos(await listPhotos(token, orderId));
  }

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [orderId]);

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const token = getSession()?.token;
    const files = e.target.files;
    if (!token || !files || files.length === 0) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        const original = await resizeImage(file, 1600, 0.8);
        const thumb = await resizeImage(file, 320, 0.6);
        await uploadPhoto(token, orderId, original, thumb, undefined);
      }
      await reload();
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  return (
    <div className="detail">
      <div className="top">
        <button onClick={onBack}>返回</button>
        <strong>发货单</strong>
      </div>

      <label className="uploader">
        {busy ? "上传中…" : "📷 拍照 / 上传发货照片"}
        <input type="file" accept="image/*" capture="environment" multiple onChange={onFiles} disabled={busy} />
      </label>

      {photos.length === 0 && <p className="status">还没有照片</p>}
      <div className="grid">
        {photos.map((p) => (
          <img key={p.id} src={photoRawUrl(p.id)} alt="发货照片" />
        ))}
      </div>
    </div>
  );
}
