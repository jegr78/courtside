ALTER TABLE booking_card
    ADD COLUMN external_price_minor integer NOT NULL DEFAULT 0,
    ADD CONSTRAINT booking_card_external_price_not_negative CHECK (external_price_minor >= 0);

ALTER TABLE booking
    ADD COLUMN amount_minor integer,
    ADD COLUMN amount_currency text,
    ADD CONSTRAINT booking_amount_in_currency CHECK (
        (amount_minor IS NULL AND amount_currency IS NULL)
        OR (amount_minor IS NOT NULL AND amount_minor >= 0
            AND amount_currency IS NOT NULL AND amount_currency ~ '^[A-Z]{3}$'));
