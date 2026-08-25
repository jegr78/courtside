ALTER TABLE message_record
    DROP CONSTRAINT message_record_kind_known,
    ADD CONSTRAINT message_record_kind_known CHECK (
        kind IN ('CREDENTIALS_NEW_ACCOUNT', 'CREDENTIALS_PASSWORD_RESET', 'BOOKING_CONFIRMED',
                 'BOOKING_PLAYER_RECORDED', 'BOOKING_PLAYER_WITHDREW'));
