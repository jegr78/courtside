ALTER TABLE booking_card
    ADD COLUMN holds_doors_open boolean NOT NULL DEFAULT false;

ALTER TABLE booking_card
    ADD CONSTRAINT booking_card_closure_holds_no_doors CHECK (
        NOT holds_doors_open OR id <> '44444444-4444-4444-4444-444444444444');

CREATE TABLE door_hold (
    id         uuid        PRIMARY KEY,
    booking_id uuid        NOT NULL,
    held_at    timestamptz NOT NULL,
    held_by    uuid        REFERENCES user_account ON DELETE SET NULL,
    ended_at   timestamptz,
    ended_by   uuid        REFERENCES user_account ON DELETE SET NULL,

    CONSTRAINT door_hold_ends_after_start CHECK (ended_at IS NULL OR ended_at >= held_at)
);

CREATE INDEX door_hold_booking ON door_hold (booking_id);
