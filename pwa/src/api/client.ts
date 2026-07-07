import type { Order, OrderStatus, Photo, OrderDetail } from "./types";

const BASE = import.meta.env.VITE_API_BASE;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) throw new ApiError(res.status, `HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function join(joinToken: string, name: string): Promise<{ sessionToken: string; user: { id: string; name: string } }> {
  const res = await fetch(`${BASE}/api/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ joinToken, name }),
  });
  return parse(res);
}

export async function listOrders(token: string, status: OrderStatus, q?: string, limit?: number, offset?: number): Promise<Order[]> {
  const params = new URLSearchParams({ status });
  if (q) params.set("q", q);
  if (limit != null) params.set("limit", String(limit));
  if (offset != null) params.set("offset", String(offset));
  const res = await fetch(`${BASE}/api/orders?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await parse<{ orders: Order[] }>(res);
  return data.orders;
}

export async function getOrder(token: string, orderId: string): Promise<OrderDetail> {
  const res = await fetch(`${BASE}/api/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return parse(res);
}

export async function listPhotos(token: string, orderId: string): Promise<Photo[]> {
  const res = await fetch(`${BASE}/api/orders/${orderId}/photos`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await parse<{ photos: Photo[] }>(res);
  return data.photos;
}

export async function uploadPhoto(token: string, orderId: string, photo: Blob, thumb: Blob, category: string, note?: string): Promise<void> {
  const fd = new FormData();
  fd.set("photo", photo, "photo.jpg");
  fd.set("thumb", thumb, "thumb.jpg");
  fd.set("category", category);
  if (note) fd.set("note", note);
  const res = await fetch(`${BASE}/api/orders/${orderId}/photos`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  await parse(res);
}

export function photoRawUrl(photoId: string): string {
  return `${BASE}/api/photos/${photoId}/raw`;
}

export async function updateName(token: string, name: string): Promise<string> {
  const res = await fetch(`${BASE}/api/me/name`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const data = await parse<{ name: string }>(res);
  return data.name;
}

export async function deletePhoto(token: string, photoId: string): Promise<void> {
  const res = await fetch(`${BASE}/api/photos/${photoId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  await parse(res);
}

// The raw-photo endpoint requires a Bearer token, which an <img> tag cannot
// send. Fetch it with auth and hand back a Blob the caller turns into an
// object URL for the <img src>.
export async function fetchPhotoBlob(token: string, photoId: string): Promise<Blob> {
  const res = await fetch(`${BASE}/api/photos/${photoId}/raw`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new ApiError(res.status, `HTTP ${res.status}`);
  return res.blob();
}
