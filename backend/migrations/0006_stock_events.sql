-- History covers every change to stock, not deliveries alone.
--
-- A weekly count is the same shape of event as an import: a batch of lines,
-- each with a before and an after, applied at one location at one moment. The
-- merchant wants one timeline answering "when was this stock last touched, and
-- by what" — not two lists they have to interleave by eye.
--
-- The purchase_order_* tables held imports only, and their name would have made
-- every future reader wonder why counts live there. They were empty in every
-- shop, so they are replaced outright rather than renamed around.
--
-- Nullability now carries meaning: filename/pdf_r2_key/material_code/
-- delivered_qty/sled are import-only and NULL on a count. expiry_updated is
-- gone entirely — BBD write-back was removed, not disabled.

DROP TABLE IF EXISTS purchase_order_import_lines;
DROP TABLE IF EXISTS purchase_order_imports;

CREATE TABLE stock_events (
  id           TEXT PRIMARY KEY,
  shop_id      TEXT NOT NULL REFERENCES shops(id),
  kind         TEXT NOT NULL,            -- 'import' | 'count'
  filename     TEXT,                     -- import only
  pdf_r2_key   TEXT,                     -- import only
  location_id  TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);
CREATE INDEX idx_stock_events_shop ON stock_events(shop_id, created_at DESC);

CREATE TABLE stock_event_lines (
  id                  TEXT PRIMARY KEY,
  event_id            TEXT NOT NULL REFERENCES stock_events(id),
  material_code       TEXT,              -- import only
  description         TEXT NOT NULL,     -- product title, or the note's line text
  shopify_variant_id  TEXT,
  delivered_qty       INTEGER,           -- import only; a count uses before/after
  qty_before          INTEGER,
  qty_after           INTEGER,
  sled                TEXT,              -- import only
  skipped             INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL,     -- 'ok' | 'error' | 'skipped'
  error               TEXT
);
CREATE INDEX idx_stock_event_lines_event ON stock_event_lines(event_id);
