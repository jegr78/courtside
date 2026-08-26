CREATE TABLE message_optout (
    user_account_id uuid        NOT NULL REFERENCES user_account (id) ON DELETE CASCADE,
    kind            text        NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_account_id, kind),
    CONSTRAINT message_optout_kind_declinable CHECK (
        kind IN ('BOOKING_CONFIRMED', 'BOOKING_PLAYER_WITHDREW', 'BOOKING_REMINDER'))
);
