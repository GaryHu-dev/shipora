export type OrderStatus = "unfulfilled" | "fulfilled" | "all";

export interface Order {
  id: string;
  order_number: string;
  customer_name: string | null;
  fulfillment_status: string;
  created_at: number;
}

export interface Photo {
  id: string;
  note: string | null;
  uploaded_at: number;
}
