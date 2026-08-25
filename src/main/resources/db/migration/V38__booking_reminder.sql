ALTER TABLE club_config
    ADD COLUMN booking_reminder_hours integer NOT NULL DEFAULT 24,
    ADD CONSTRAINT club_config_booking_reminder_hours_range
        CHECK (booking_reminder_hours BETWEEN 0 AND 168);

ALTER TABLE club_config ALTER COLUMN booking_reminder_hours DROP DEFAULT;

ALTER TABLE booking ADD COLUMN reminded_at timestamptz;

ALTER TABLE message_record
    DROP CONSTRAINT message_record_kind_known,
    ADD CONSTRAINT message_record_kind_known CHECK (
        kind IN ('CREDENTIALS_NEW_ACCOUNT', 'CREDENTIALS_PASSWORD_RESET', 'BOOKING_CONFIRMED',
                 'BOOKING_PLAYER_RECORDED', 'BOOKING_PLAYER_WITHDREW', 'BOOKING_DISPLACED',
                 'BOOKING_REMINDER'));
