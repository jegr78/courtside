ALTER TABLE paypal_order
    ADD COLUMN client_fingerprint text,
    ADD CONSTRAINT paypal_order_client_fingerprint CHECK (client_fingerprint ~ '^[0-9a-f]{64}$');

UPDATE paypal_order
SET client_fingerprint = encode(sha256(convert_to(settings.client_id, 'UTF8')), 'hex')
FROM paypal_settings settings
WHERE settings.environment = paypal_order.environment
  AND paypal_order.created_at >= settings.secret_stored_at;
