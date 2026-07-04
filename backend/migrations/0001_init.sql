CREATE TABLE shops (
  id            TEXT PRIMARY KEY,
  shop_domain   TEXT NOT NULL UNIQUE,
  access_token  TEXT NOT NULL,
  join_secret   TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',
  installed_at  INTEGER NOT NULL
);

CREATE TABLE users (
  id         TEXT PRIMARY KEY,
  shop_id    TEXT NOT NULL REFERENCES shops(id),
  name       TEXT NOT NULL,
  email      TEXT,
  joined_at  INTEGER NOT NULL
);
CREATE INDEX idx_users_shop ON users(shop_id);

CREATE TABLE orders (
  id                 TEXT PRIMARY KEY,
  shop_id            TEXT NOT NULL REFERENCES shops(id),
  shopify_order_id   TEXT NOT NULL,
  order_number       TEXT NOT NULL,
  customer_name      TEXT,
  fulfillment_status TEXT NOT NULL DEFAULT 'unfulfilled',
  created_at         INTEGER NOT NULL,
  synced_at          INTEGER NOT NULL,
  UNIQUE (shop_id, shopify_order_id)
);
CREATE INDEX idx_orders_shop_status ON orders(shop_id, fulfillment_status);

CREATE TABLE shipment_photos (
  id           TEXT PRIMARY KEY,
  shop_id      TEXT NOT NULL REFERENCES shops(id),
  order_id     TEXT NOT NULL REFERENCES orders(id),
  uploaded_by  TEXT NOT NULL REFERENCES users(id),
  r2_key       TEXT NOT NULL,
  thumb_key    TEXT,
  note         TEXT,
  uploaded_at  INTEGER NOT NULL
);
CREATE INDEX idx_photos_order ON shipment_photos(order_id);
