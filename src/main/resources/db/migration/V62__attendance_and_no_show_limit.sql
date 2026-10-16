CREATE TABLE attendance_policy (
    id                    uuid    PRIMARY KEY,
    enabled               boolean NOT NULL,
    release_after_minutes integer,

    CONSTRAINT attendance_policy_release_after_minutes_range CHECK (
        release_after_minutes IS NULL OR release_after_minutes BETWEEN 5 AND 120),
    CONSTRAINT attendance_policy_release_needs_attendance CHECK (
        release_after_minutes IS NULL OR enabled)
);

INSERT INTO attendance_policy (id, enabled, release_after_minutes)
VALUES ('a77e0000-0000-0000-0000-000000000001', false, NULL);

CREATE TABLE booking_attendance (
    booking_id  uuid        PRIMARY KEY,
    outcome     text        NOT NULL,
    recorded_at timestamptz NOT NULL,
    recorded_by uuid        REFERENCES user_account ON DELETE SET NULL,
    lifted_at   timestamptz,
    lifted_by   uuid        REFERENCES user_account ON DELETE SET NULL,

    CONSTRAINT booking_attendance_outcome_known CHECK (outcome IN ('ATTENDED', 'NO_SHOW')),
    CONSTRAINT booking_attendance_only_a_no_show_is_lifted CHECK (lifted_at IS NULL OR outcome = 'NO_SHOW')
);

CREATE INDEX booking_attendance_counting_no_shows ON booking_attendance (booking_id)
    WHERE outcome = 'NO_SHOW' AND lifted_at IS NULL;

CREATE TABLE booking_release (
    booking_id  uuid        PRIMARY KEY,
    released_at timestamptz NOT NULL
);

ALTER TABLE rule_definition DROP CONSTRAINT rule_definition_rule_type_known;

ALTER TABLE rule_definition ADD CONSTRAINT rule_definition_rule_type_known
    CHECK (rule_type IN ('OPENING_HOURS', 'SLOT_GRID', 'ADVANCE_WINDOW', 'MAX_OPEN_BOOKINGS',
                         'MAX_BOOKING_DURATION', 'CANCELLATION_DEADLINE', 'NO_COURT_BOOKING',
                         'BOOKING_HOURS', 'WEEKLY_BOOKED_HOURS', 'MIN_BOOKING_DURATION',
                         'NO_SHOW_LIMIT'));

ALTER TABLE message_record
    DROP CONSTRAINT message_record_kind_known,
    ADD CONSTRAINT message_record_kind_known CHECK (
        kind IN ('ACCOUNT_WELCOME', 'CREDENTIALS_NEW_ACCOUNT', 'CREDENTIALS_PASSWORD_RESET', 'BOOKING_CONFIRMED',
                 'BOOKING_PLAYER_RECORDED', 'BOOKING_PLAYER_WITHDREW', 'BOOKING_DISPLACED',
                 'BOOKING_REMINDER', 'ACCOUNT_USERNAME_REMINDER', 'ACCOUNT_PASSWORD_RESET_CODE',
                 'BOOKING_CANCELLED', 'BOOKING_CANCELLED_BY_CLUB', 'BOOKING_RELEASED', 'BOOKING_SERIES_CREATED',
                 'BOOKING_SERIES_CANCELLED_BY_CLUB', 'BOOKING_SERIES_MOVED_BY_CLUB', 'WAITLIST_OFFER',
                 'BOOKING_PARTNER_FOUND', 'BOOKING_PLACE_TAKEN'));

ALTER TABLE notification
    DROP CONSTRAINT notification_kind_known,
    ADD CONSTRAINT notification_kind_known CHECK (
        kind IN ('ACCOUNT_WELCOME', 'CREDENTIALS_NEW_ACCOUNT', 'CREDENTIALS_PASSWORD_RESET', 'BOOKING_CONFIRMED',
                 'BOOKING_PLAYER_RECORDED', 'BOOKING_PLAYER_WITHDREW', 'BOOKING_DISPLACED',
                 'BOOKING_REMINDER', 'ACCOUNT_USERNAME_REMINDER', 'ACCOUNT_PASSWORD_RESET_CODE',
                 'BOOKING_CANCELLED', 'BOOKING_CANCELLED_BY_CLUB', 'BOOKING_RELEASED', 'BOOKING_SERIES_CREATED',
                 'BOOKING_SERIES_CANCELLED_BY_CLUB', 'BOOKING_SERIES_MOVED_BY_CLUB', 'WAITLIST_OFFER',
                 'BOOKING_PARTNER_FOUND', 'BOOKING_PLACE_TAKEN'));
