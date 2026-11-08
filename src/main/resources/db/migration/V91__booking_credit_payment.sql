ALTER TABLE credit_entry
    ADD COLUMN booking_id uuid,
    DROP CONSTRAINT credit_entry_kind_sign,
    DROP CONSTRAINT credit_entry_amount_bounded,
    ADD CONSTRAINT credit_entry_kind_sign CHECK (
        (kind IN ('CREDIT', 'BOOKING_REFUND') AND amount_minor > 0)
        OR (kind IN ('PAYOUT', 'BOOKING_DEBIT') AND amount_minor < 0)),
    ADD CONSTRAINT credit_entry_amount_bounded CHECK (
        kind IN ('BOOKING_DEBIT', 'BOOKING_REFUND') OR amount_minor BETWEEN -1000000 AND 1000000),
    ADD CONSTRAINT credit_entry_booking_reference CHECK (
        (kind IN ('BOOKING_DEBIT', 'BOOKING_REFUND')) = (booking_id IS NOT NULL));

CREATE UNIQUE INDEX credit_entry_booking_kind ON credit_entry (booking_id, kind) WHERE booking_id IS NOT NULL;
