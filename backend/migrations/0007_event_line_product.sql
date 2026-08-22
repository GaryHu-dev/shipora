-- History recorded the delivery note's own wording ("ANC BTR SLTD MY 24X454G
-- CAN CTN") and nothing else, so a record could not say WHICH Shopify product
-- it had changed — the one question the record exists to answer. The supplier's
-- text still matters for lines that matched nothing, so both are kept:
-- description stays the source's wording, product_title is what was written to.
ALTER TABLE stock_event_lines ADD COLUMN product_title TEXT;
