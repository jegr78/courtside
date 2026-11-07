CREATE TABLE registration_verification (
    account_id uuid        PRIMARY KEY REFERENCES user_account ON DELETE CASCADE,
    code_hash  text        UNIQUE CONSTRAINT registration_verification_code_hashed
                           CHECK (code_hash ~ '^[0-9a-f]{64}$'),
    security_epoch bigint  NOT NULL,
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL CHECK (expires_at > created_at)
);

CREATE INDEX registration_verification_expiry_idx ON registration_verification (expires_at);

ALTER TABLE club_config
    ADD COLUMN registration_text_de text CHECK (char_length(registration_text_de) <= 2000),
    ADD COLUMN registration_text_en text CHECK (char_length(registration_text_en) <= 2000);

ALTER TABLE message_record
    DROP CONSTRAINT message_record_kind_known,
    ADD CONSTRAINT message_record_kind_known CHECK (
        kind IN ('ACCOUNT_WELCOME', 'CREDENTIALS_NEW_ACCOUNT', 'CREDENTIALS_PASSWORD_RESET', 'BOOKING_CONFIRMED',
                 'BOOKING_PLAYER_RECORDED', 'BOOKING_PLAYER_WITHDREW', 'BOOKING_DISPLACED',
                 'BOOKING_REMINDER', 'ACCOUNT_USERNAME_REMINDER', 'ACCOUNT_PASSWORD_RESET_CODE', 'ACCOUNT_SECURITY_CHANGED', 'ACCOUNT_MFA_RECOVERY_CODE',
                 'ACCOUNT_FACTOR_GUESSING_BLOCKED', 'ACCOUNT_ADDRESS_CHANGED',
                 'BOOKING_CANCELLED', 'BOOKING_CANCELLED_BY_CLUB', 'BOOKING_RELEASED', 'BOOKING_SERIES_CREATED',
                 'BOOKING_SERIES_CANCELLED_BY_CLUB', 'BOOKING_SERIES_MOVED_BY_CLUB', 'WAITLIST_OFFER',
                 'BOOKING_PARTNER_FOUND', 'BOOKING_PLACE_TAKEN', 'ACCESS_CODE_CHANGED', 'MEMBERS_DOOR_CODE_CHANGED',
                 'ACCESS_CODE_READY',
                 'REGISTRATION_VERIFICATION', 'REGISTRATION_NAME_TAKEN'));

ALTER TABLE notification
    DROP CONSTRAINT notification_kind_known,
    ADD CONSTRAINT notification_kind_known CHECK (
        kind IN ('ACCOUNT_WELCOME', 'CREDENTIALS_NEW_ACCOUNT', 'CREDENTIALS_PASSWORD_RESET', 'BOOKING_CONFIRMED',
                 'BOOKING_PLAYER_RECORDED', 'BOOKING_PLAYER_WITHDREW', 'BOOKING_DISPLACED',
                 'BOOKING_REMINDER', 'ACCOUNT_USERNAME_REMINDER', 'ACCOUNT_PASSWORD_RESET_CODE', 'ACCOUNT_SECURITY_CHANGED', 'ACCOUNT_MFA_RECOVERY_CODE',
                 'ACCOUNT_FACTOR_GUESSING_BLOCKED', 'ACCOUNT_ADDRESS_CHANGED',
                 'BOOKING_CANCELLED', 'BOOKING_CANCELLED_BY_CLUB', 'BOOKING_RELEASED', 'BOOKING_SERIES_CREATED',
                 'BOOKING_SERIES_CANCELLED_BY_CLUB', 'BOOKING_SERIES_MOVED_BY_CLUB', 'WAITLIST_OFFER',
                 'BOOKING_PARTNER_FOUND', 'BOOKING_PLACE_TAKEN', 'ACCESS_CODE_CHANGED', 'MEMBERS_DOOR_CODE_CHANGED',
                 'ACCESS_CODE_READY',
                 'REGISTRATION_VERIFICATION', 'REGISTRATION_NAME_TAKEN'));
