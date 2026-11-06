ALTER TABLE user_account_role
    DROP CONSTRAINT user_account_role_role_known,
    ADD CONSTRAINT user_account_role_role_known
        CHECK (role IN ('MEMBER', 'TRAINER', 'SPORT_DIRECTOR', 'YOUTH_DIRECTOR', 'GROUNDSKEEPER', 'TREASURER',
                        'ADMIN', 'EXTERNAL'));

ALTER TABLE booking_card_allowed_role
    DROP CONSTRAINT booking_card_allowed_role_known,
    ADD CONSTRAINT booking_card_allowed_role_known
        CHECK (role IN ('MEMBER', 'TRAINER', 'SPORT_DIRECTOR', 'YOUTH_DIRECTOR', 'GROUNDSKEEPER', 'TREASURER',
                        'ADMIN', 'EXTERNAL'));

ALTER TABLE club_config ADD COLUMN external_bookings boolean NOT NULL DEFAULT false;
