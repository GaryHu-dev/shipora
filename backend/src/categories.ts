export const PHOTO_CATEGORIES = [
  "shipping_photo",
  "packing_slip",
  "shipping_label",
  "damage",
  "document",
  "other",
] as const;

export const CATEGORY_LABELS: Record<string, string> = {
  shipping_photo: "Shipping photo",
  packing_slip: "Packing slip",
  shipping_label: "Shipping label",
  damage: "Damage / issue",
  document: "Document",
  other: "Other",
};

export function normalizeCategory(v: unknown): string {
  return typeof v === "string" && (PHOTO_CATEGORIES as readonly string[]).includes(v) ? v : "shipping_photo";
}
