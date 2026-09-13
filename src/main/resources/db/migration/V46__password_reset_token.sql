CREATE TABLE password_reset_token (
    account_id     uuid        PRIMARY KEY REFERENCES user_account ON DELETE CASCADE,
    code_hash      text        NOT NULL UNIQUE CONSTRAINT password_reset_token_code_hashed
                               CHECK (code_hash ~ '^[0-9a-f]{64}$'),
    address_hash   text        NOT NULL CHECK (address_hash ~ '^[0-9a-f]{64}$'),
    security_epoch bigint      NOT NULL,
    created_at     timestamptz NOT NULL,
    expires_at     timestamptz NOT NULL CHECK (expires_at > created_at)
);

CREATE INDEX password_reset_token_expiry_idx
    ON password_reset_token (expires_at);

CREATE TABLE password_reset_mail_limit (
    account_id        uuid        PRIMARY KEY REFERENCES user_account ON DELETE CASCADE,
    mailed_count      integer     NOT NULL CHECK (mailed_count > 0),
    window_started_at timestamptz NOT NULL
);

CREATE INDEX password_reset_mail_limit_expiry_idx
    ON password_reset_mail_limit (window_started_at);

ALTER TABLE club_config
    ADD COLUMN password_reset_token_minutes integer NOT NULL DEFAULT 60
        CONSTRAINT club_config_password_reset_token_minutes_range
        CHECK (password_reset_token_minutes BETWEEN 15 AND 1440);

ALTER TABLE club_config
    ALTER COLUMN password_reset_token_minutes DROP DEFAULT;

ALTER TABLE message_record
    DROP CONSTRAINT message_record_kind_known,
    ADD CONSTRAINT message_record_kind_known CHECK (
        kind IN ('CREDENTIALS_NEW_ACCOUNT', 'CREDENTIALS_PASSWORD_RESET', 'BOOKING_CONFIRMED',
                 'BOOKING_PLAYER_RECORDED', 'BOOKING_PLAYER_WITHDREW', 'BOOKING_DISPLACED',
                 'BOOKING_REMINDER', 'ACCOUNT_USERNAME_REMINDER',
                 'ACCOUNT_PASSWORD_RESET_CODE'));
