CREATE TABLE material_code_map (
  id                  TEXT PRIMARY KEY,
  shop_id             TEXT NOT NULL REFERENCES shops(id),
  material_code       TEXT NOT NULL,
  shopify_variant_id  TEXT NOT NULL,
  updated_at          INTEGER NOT NULL,
  UNIQUE (shop_id, material_code)
);
CREATE INDEX idx_material_map_shop ON material_code_map(shop_id);

CREATE TABLE purchase_order_imports (
  id            TEXT PRIMARY KEY,
  shop_id       TEXT NOT NULL REFERENCES shops(id),
  filename      TEXT NOT NULL,
  pdf_r2_key    TEXT NOT NULL,
  location_id   TEXT NOT NULL,
  imported_at   INTEGER NOT NULL
);
CREATE INDEX idx_po_imports_shop ON purchase_order_imports(shop_id, imported_at DESC);

CREATE TABLE purchase_order_import_lines (
  id                  TEXT PRIMARY KEY,
  import_id           TEXT NOT NULL REFERENCES purchase_order_imports(id),
  material_code       TEXT NOT NULL,
  description         TEXT NOT NULL,
  shopify_variant_id  TEXT,
  delivered_qty       INTEGER NOT NULL,
  qty_before          INTEGER,
  qty_after           INTEGER,
  sled                TEXT,
  expiry_updated      INTEGER NOT NULL DEFAULT 0,
  skipped             INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL
);
CREATE INDEX idx_po_import_lines_import ON purchase_order_import_lines(import_id);
