ALTER TABLE booking_card
    ADD COLUMN signals_occupancy boolean NOT NULL DEFAULT true;

UPDATE booking_card SET signals_occupancy = false WHERE id = '44444444-4444-4444-4444-444444444444';

ALTER TABLE booking_card
    ADD CONSTRAINT booking_card_closure_signals_no_occupancy CHECK (
        NOT signals_occupancy OR id <> '44444444-4444-4444-4444-444444444444');

CREATE TABLE occupancy_key (
    id         smallint    PRIMARY KEY,
    key_hash   text        NOT NULL,
    created_at timestamptz NOT NULL,
    CONSTRAINT occupancy_key_single_row CHECK (id = 1)
);

ALTER TABLE domain_event
    DROP CONSTRAINT domain_event_subject_required,
    ADD CONSTRAINT domain_event_subject_required CHECK (
        subject_id IS NOT NULL
            OR event_type IN ('dataexchange.log.exported', 'booking.occupancyKey.created', 'booking.occupancyKey.revoked'));
