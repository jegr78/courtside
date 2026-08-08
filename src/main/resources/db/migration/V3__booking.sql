CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE booking (
    id           uuid PRIMARY KEY,
    card_id      uuid        NOT NULL REFERENCES booking_card,
    status       text        NOT NULL,
    booked_by    uuid,
    note         text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    cancelled_at timestamptz,
    cancelled_by uuid,
    CONSTRAINT booking_status_values CHECK (status IN ('CONFIRMED', 'CANCELLED'))
);

CREATE TABLE court_allocation (
    id         uuid PRIMARY KEY,
    booking_id uuid        NOT NULL REFERENCES booking ON DELETE CASCADE,
    court_id   uuid        NOT NULL REFERENCES court,
    starts_at  timestamptz NOT NULL,
    ends_at    timestamptz NOT NULL,
    status     text        NOT NULL,

    CONSTRAINT court_allocation_valid_range CHECK (ends_at > starts_at),
    CONSTRAINT court_allocation_status_values CHECK (status IN ('CONFIRMED', 'CANCELLED')),

    -- '[)' keeps the upper bound exclusive so back-to-back bookings do not collide
    CONSTRAINT court_allocation_no_overlap EXCLUDE USING gist (
        court_id WITH =,
        tstzrange(starts_at, ends_at, '[)') WITH &&
    ) WHERE (status <> 'CANCELLED')
);

CREATE INDEX court_allocation_by_court_and_start
    ON court_allocation (court_id, starts_at)
    WHERE status <> 'CANCELLED';
