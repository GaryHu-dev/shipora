-- backend/migrations/0005_tracked_products.sql
--
-- Which products the merchant watches on the Stock tab, and how far the
-- weekly count has got. Deliberately holds NO stock quantity and NO BBD:
-- those are read live from Shopify every time, so this table can never drift
-- out of agreement with it.
CREATE TABLE tracked_products (
  id                    TEXT PRIMARY KEY,
  shop_id               TEXT NOT NULL REFERENCES shops(id),
  shopify_variant_id    TEXT NOT NULL,
  shopify_product_id    TEXT NOT NULL,
  added_at              INTEGER NOT NULL,
  last_counted_at       INTEGER,
  last_bbd_checked_at   INTEGER,
  UNIQUE (shop_id, shopify_variant_id)
);

CREATE INDEX idx_tracked_shop ON tracked_products(shop_id, added_at DESC);
