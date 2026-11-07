ALTER TABLE user_account ADD COLUMN anonymised_at timestamptz;
ALTER TABLE user_account ADD CONSTRAINT user_account_anonymised_is_disabled
    CHECK (anonymised_at IS NULL OR (NOT enabled AND password_hash IS NULL));
