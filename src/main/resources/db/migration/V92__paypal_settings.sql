CREATE TABLE paypal_settings (
    id uuid PRIMARY KEY,
    singleton boolean NOT NULL DEFAULT true UNIQUE,
    client_id text NOT NULL,
    secret_ciphertext text,
    secret_stored_at timestamptz,
    environment text NOT NULL,
    enabled boolean NOT NULL,
    updated_at timestamptz NOT NULL,
    updated_by uuid,
    CONSTRAINT paypal_settings_single_row CHECK (singleton),
    CONSTRAINT paypal_settings_environment CHECK (environment IN ('SANDBOX', 'LIVE')),
    CONSTRAINT paypal_settings_client_id_length CHECK (length(client_id) BETWEEN 1 AND 200),
    CONSTRAINT paypal_settings_secret_stored CHECK ((secret_ciphertext IS NULL) = (secret_stored_at IS NULL)),
    CONSTRAINT paypal_settings_enabled_with_secret CHECK (NOT enabled OR secret_ciphertext IS NOT NULL)
);
