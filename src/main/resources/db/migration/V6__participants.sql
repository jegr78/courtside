CREATE TABLE participant_card (
    id       uuid    PRIMARY KEY,
    label    text    NOT NULL,
    active   boolean NOT NULL DEFAULT true,
    capacity integer,
    CONSTRAINT participant_card_unique_label UNIQUE (label),
    CONSTRAINT participant_card_capacity_positive CHECK (capacity IS NULL OR capacity > 0),
    CONSTRAINT participant_card_label_not_blank CHECK (length(btrim(label)) > 0)
);

INSERT INTO participant_card (id, label, capacity) VALUES
    ('55555555-5555-5555-5555-555555555555', 'Ball machine', 1),
    ('66666666-6666-6666-6666-666666666666', 'Looking for a partner', NULL);

CREATE TABLE booking_participant (
    id         uuid    PRIMARY KEY,
    booking_id uuid    NOT NULL REFERENCES booking ON DELETE CASCADE,
    kind       text    NOT NULL,
    person_id  uuid    REFERENCES person,
    guest_name text,
    card_id    uuid    REFERENCES participant_card,
    position   integer NOT NULL,
    CONSTRAINT booking_participant_kind_known CHECK (kind IN ('MEMBER', 'GUEST', 'CARD')),
    CONSTRAINT booking_participant_kind_matches_filler CHECK (
        (kind = 'MEMBER' AND person_id IS NOT NULL AND guest_name IS NULL AND card_id IS NULL)
        OR (kind = 'GUEST' AND person_id IS NULL AND guest_name IS NOT NULL AND card_id IS NULL)
        OR (kind = 'CARD' AND person_id IS NULL AND guest_name IS NULL AND card_id IS NOT NULL)
    ),
    CONSTRAINT booking_participant_unique_position UNIQUE (booking_id, position)
);

CREATE UNIQUE INDEX booking_participant_unique_person
    ON booking_participant (booking_id, person_id)
    WHERE person_id IS NOT NULL;
