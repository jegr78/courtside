ALTER TABLE club_config
    ADD COLUMN currency text NOT NULL DEFAULT 'EUR',
    ADD CONSTRAINT club_config_currency_code CHECK (currency ~ '^[A-Z]{3}$');

ALTER TABLE booking_card
    ADD COLUMN guest_fee_minor integer NOT NULL DEFAULT 0,
    ADD CONSTRAINT booking_card_guest_fee_not_negative CHECK (guest_fee_minor >= 0);

ALTER TABLE booking_participant
    ADD COLUMN guest_fee_minor integer,
    ADD COLUMN guest_fee_currency text;

UPDATE booking_participant
SET guest_fee_minor = 0, guest_fee_currency = (SELECT currency FROM club_config)
WHERE kind = 'GUEST';

ALTER TABLE booking_participant
    ADD CONSTRAINT booking_participant_guest_fee_matches_kind CHECK (
        (kind = 'GUEST' AND guest_fee_minor IS NOT NULL AND guest_fee_minor >= 0
            AND guest_fee_currency IS NOT NULL AND guest_fee_currency ~ '^[A-Z]{3}$')
        OR (kind <> 'GUEST' AND guest_fee_minor IS NULL AND guest_fee_currency IS NULL));
