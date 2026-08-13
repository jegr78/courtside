CREATE TABLE booking_card_managing_role (
    booking_card_id uuid NOT NULL REFERENCES booking_card ON DELETE CASCADE,
    role            text NOT NULL,
    PRIMARY KEY (booking_card_id, role),
    CONSTRAINT booking_card_managing_role_known
        CHECK (role IN ('MEMBER', 'TRAINER', 'SPORT_DIRECTOR', 'YOUTH_DIRECTOR',
                        'GROUNDSKEEPER', 'TREASURER', 'ADMIN'))
);

INSERT INTO booking_card_managing_role (booking_card_id, role)
SELECT booking_card_id, role
FROM booking_card_allowed_role
WHERE role <> 'MEMBER';
