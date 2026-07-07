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
  category: string;
  content_type: string | null;
  note: string | null;
  uploaded_at: number;
  uploaded_by_name: string;
}

export interface LineItem {
  title: string;
  quantity: number;
  sku?: string | null;
  imageUrl?: string | null;
}

export interface ShippingAddress {
  name?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  zip?: string | null;
  country?: string | null;
  phone?: string | null;
}

export interface OrderDetail {
  order: {
    order_number: string;
    customer_name: string | null;
    fulfillment_status: string;
    created_at: number;
  };
  items: LineItem[];
  address: ShippingAddress | null;
  billing?: ShippingAddress | null;
  pickup?: boolean;
}
