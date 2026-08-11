CREATE TABLE booking_card (
    id                    uuid       PRIMARY KEY,
    label                 text       NOT NULL,
    color                 text       NOT NULL,
    required_role         text,
    allowed_player_counts smallint[] NOT NULL DEFAULT '{}',
    show_generic_occupancy boolean    NOT NULL DEFAULT false,
    counts_against_limits boolean    NOT NULL,
    guest_allowed         boolean    NOT NULL,
    active                boolean    NOT NULL DEFAULT true,
    CONSTRAINT booking_card_unique_label UNIQUE (label),
    CONSTRAINT booking_card_label_not_blank CHECK (length(btrim(label)) > 0),
    CONSTRAINT booking_card_color_hex CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
    CONSTRAINT booking_card_allowed_player_counts_positive CHECK (0 < ALL (allowed_player_counts)),
    CONSTRAINT booking_card_required_role_known
        CHECK (required_role IS NULL
               OR required_role IN ('MEMBER', 'TRAINER', 'GROUNDSKEEPER', 'TREASURER', 'ADMIN'))
);

INSERT INTO booking_card
    (id, label, color, required_role, allowed_player_counts, show_generic_occupancy,
     counts_against_limits, guest_allowed)
VALUES
    ('11111111-1111-1111-1111-111111111111', 'Member booking', '#B85C38',
     'MEMBER',        '{2,4}', true,  true,  true),
    ('22222222-2222-2222-2222-222222222222', 'Training',       '#34584A',
     'TRAINER',       '{}',    false, false, false),
    ('33333333-3333-3333-3333-333333333333', 'League match',   '#3A4A5C',
     'TRAINER',       '{}',    false, false, false),
    ('44444444-4444-4444-4444-444444444444', 'Court closed',   '#E8DDD4',
     'GROUNDSKEEPER', '{}',    false, false, false);
