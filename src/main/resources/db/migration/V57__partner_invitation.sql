CREATE TABLE partner_invitation (
    id             uuid PRIMARY KEY,
    booking_id     uuid        NOT NULL,
    participant_id uuid        NOT NULL,
    published_at   timestamptz NOT NULL,

    CONSTRAINT partner_invitation_one_per_booking UNIQUE (booking_id)
);

CREATE INDEX partner_invitation_participant ON partner_invitation (participant_id);

ALTER TABLE message_record
    DROP CONSTRAINT message_record_kind_known,
    ADD CONSTRAINT message_record_kind_known CHECK (
        kind IN ('ACCOUNT_WELCOME', 'CREDENTIALS_NEW_ACCOUNT', 'CREDENTIALS_PASSWORD_RESET', 'BOOKING_CONFIRMED',
                 'BOOKING_PLAYER_RECORDED', 'BOOKING_PLAYER_WITHDREW', 'BOOKING_DISPLACED',
                 'BOOKING_REMINDER', 'ACCOUNT_USERNAME_REMINDER', 'ACCOUNT_PASSWORD_RESET_CODE',
                 'BOOKING_CANCELLED', 'BOOKING_CANCELLED_BY_CLUB', 'BOOKING_SERIES_CREATED',
                 'BOOKING_SERIES_CANCELLED_BY_CLUB', 'BOOKING_SERIES_MOVED_BY_CLUB', 'WAITLIST_OFFER',
                 'BOOKING_PARTNER_FOUND', 'BOOKING_PLACE_TAKEN'));

ALTER TABLE notification
    DROP CONSTRAINT notification_kind_known,
    ADD CONSTRAINT notification_kind_known CHECK (
        kind IN ('ACCOUNT_WELCOME', 'CREDENTIALS_NEW_ACCOUNT', 'CREDENTIALS_PASSWORD_RESET', 'BOOKING_CONFIRMED',
                 'BOOKING_PLAYER_RECORDED', 'BOOKING_PLAYER_WITHDREW', 'BOOKING_DISPLACED',
                 'BOOKING_REMINDER', 'ACCOUNT_USERNAME_REMINDER', 'ACCOUNT_PASSWORD_RESET_CODE',
                 'BOOKING_CANCELLED', 'BOOKING_CANCELLED_BY_CLUB', 'BOOKING_SERIES_CREATED',
                 'BOOKING_SERIES_CANCELLED_BY_CLUB', 'BOOKING_SERIES_MOVED_BY_CLUB', 'WAITLIST_OFFER',
                 'BOOKING_PARTNER_FOUND', 'BOOKING_PLACE_TAKEN'));

ALTER TABLE message_optout
    DROP CONSTRAINT message_optout_kind_declinable,
    ADD CONSTRAINT message_optout_kind_declinable CHECK (
        kind IN ('BOOKING_CONFIRMED', 'BOOKING_PLAYER_WITHDREW', 'BOOKING_REMINDER',
                 'BOOKING_CANCELLED', 'BOOKING_SERIES_CREATED', 'BOOKING_PARTNER_FOUND', 'BOOKING_PLACE_TAKEN'));
