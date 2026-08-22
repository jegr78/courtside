ALTER TABLE user_account
    ADD COLUMN credentials_expire_at timestamptz;

ALTER TABLE club_config
    ADD COLUMN new_account_credential_hours integer NOT NULL DEFAULT 168,
    ADD COLUMN password_reset_credential_hours integer NOT NULL DEFAULT 24;

ALTER TABLE club_config
    ADD CONSTRAINT club_config_new_account_credential_hours_range
        CHECK (new_account_credential_hours BETWEEN 1 AND 8760),
    ADD CONSTRAINT club_config_password_reset_credential_hours_range
        CHECK (password_reset_credential_hours BETWEEN 1 AND 8760);

ALTER TABLE club_config
    ALTER COLUMN new_account_credential_hours DROP DEFAULT,
    ALTER COLUMN password_reset_credential_hours DROP DEFAULT;
