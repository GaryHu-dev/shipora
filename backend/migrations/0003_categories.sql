ALTER TABLE shipment_photos ADD COLUMN category TEXT NOT NULL DEFAULT 'shipping_photo';
ALTER TABLE shipment_photos ADD COLUMN content_type TEXT;
