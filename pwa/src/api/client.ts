import type { Order, OrderStatus, Photo } from "./types";

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

export async function listOrders(token: string, status: OrderStatus, q?: string): Promise<Order[]> {
  const params = new URLSearchParams({ status });
  if (q) params.set("q", q);
  const res = await fetch(`${BASE}/api/orders?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await parse<{ orders: Order[] }>(res);
  return data.orders;
}

export async function listPhotos(token: string, orderId: string): Promise<Photo[]> {
  const res = await fetch(`${BASE}/api/orders/${orderId}/photos`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await parse<{ photos: Photo[] }>(res);
  return data.photos;
}

export async function uploadPhoto(token: string, orderId: string, photo: Blob, thumb: Blob, note?: string): Promise<void> {
  const fd = new FormData();
  fd.set("photo", photo, "photo.jpg");
  fd.set("thumb", thumb, "thumb.jpg");
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
