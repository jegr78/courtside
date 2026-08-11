ALTER TABLE user_account_role
    DROP CONSTRAINT user_account_role_role_known;

ALTER TABLE user_account_role
    ADD CONSTRAINT user_account_role_role_known
        CHECK (role IN ('MEMBER', 'TRAINER', 'SPORT_DIRECTOR', 'YOUTH_DIRECTOR',
                        'GROUNDSKEEPER', 'TREASURER', 'ADMIN'));

CREATE TABLE booking_card_allowed_role (
    booking_card_id uuid NOT NULL REFERENCES booking_card ON DELETE CASCADE,
    role            text NOT NULL,
    PRIMARY KEY (booking_card_id, role),
    CONSTRAINT booking_card_allowed_role_known
        CHECK (role IN ('MEMBER', 'TRAINER', 'SPORT_DIRECTOR', 'YOUTH_DIRECTOR',
                        'GROUNDSKEEPER', 'TREASURER', 'ADMIN'))
);

INSERT INTO booking_card_allowed_role (booking_card_id, role)
SELECT id, required_role
FROM booking_card
WHERE required_role IS NOT NULL;

DELETE FROM booking_card_allowed_role
WHERE booking_card_id IN (
    '11111111-1111-1111-1111-111111111111',
    '33333333-3333-3333-3333-333333333333'
);

INSERT INTO booking_card_allowed_role (booking_card_id, role)
VALUES
    ('22222222-2222-2222-2222-222222222222', 'SPORT_DIRECTOR'),
    ('22222222-2222-2222-2222-222222222222', 'YOUTH_DIRECTOR'),
    ('33333333-3333-3333-3333-333333333333', 'SPORT_DIRECTOR'),
    ('33333333-3333-3333-3333-333333333333', 'YOUTH_DIRECTOR');

ALTER TABLE booking_card
    DROP CONSTRAINT booking_card_required_role_known,
    DROP COLUMN required_role;
