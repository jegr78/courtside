ALTER TABLE booking
    DROP CONSTRAINT booking_status_values,
    DROP CONSTRAINT booking_cancellation_reason_known,
    ADD COLUMN payment_expires_at timestamptz,
    ADD CONSTRAINT booking_status_values CHECK (status IN ('PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED')),
    ADD CONSTRAINT booking_cancellation_reason_known CHECK (
        cancellation_reason IN ('COURT_CONDITION', 'WEATHER', 'CLUB_EVENT', 'MAINTENANCE', 'OTHER',
                                'PAYMENT_EXPIRED')),
    ADD CONSTRAINT booking_pending_has_expiry CHECK (
        status <> 'PENDING_PAYMENT' OR payment_expires_at IS NOT NULL);

ALTER TABLE court_allocation
    DROP CONSTRAINT court_allocation_status_values,
    ADD CONSTRAINT court_allocation_status_values CHECK (
        status IN ('PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED'));

CREATE UNIQUE INDEX booking_one_pending_per_account ON booking (booked_by) WHERE status = 'PENDING_PAYMENT';

ALTER TABLE credit_entry
    ADD COLUMN paypal_order_id text,
    DROP CONSTRAINT credit_entry_kind_sign,
    DROP CONSTRAINT credit_entry_amount_bounded,
    DROP CONSTRAINT credit_entry_booking_reference,
    ADD CONSTRAINT credit_entry_kind_sign CHECK (
        (kind IN ('CREDIT', 'BOOKING_REFUND', 'PAYPAL_PAYMENT', 'PAYPAL_LATE_CAPTURE') AND amount_minor > 0)
        OR (kind IN ('PAYOUT', 'BOOKING_DEBIT') AND amount_minor < 0)),
    ADD CONSTRAINT credit_entry_amount_bounded CHECK (
        kind IN ('BOOKING_DEBIT', 'BOOKING_REFUND', 'PAYPAL_PAYMENT', 'PAYPAL_LATE_CAPTURE')
        OR amount_minor BETWEEN -1000000 AND 1000000),
    ADD CONSTRAINT credit_entry_booking_reference CHECK (
        (kind IN ('BOOKING_DEBIT', 'BOOKING_REFUND', 'PAYPAL_PAYMENT', 'PAYPAL_LATE_CAPTURE'))
            = (booking_id IS NOT NULL)),
    ADD CONSTRAINT credit_entry_paypal_order_reference CHECK (
        (kind IN ('PAYPAL_PAYMENT', 'PAYPAL_LATE_CAPTURE')) = (paypal_order_id IS NOT NULL));

CREATE UNIQUE INDEX credit_entry_paypal_order ON credit_entry (paypal_order_id) WHERE paypal_order_id IS NOT NULL;

CREATE TABLE paypal_order (
    order_id text PRIMARY KEY,
    booking_id uuid NOT NULL UNIQUE,
    account_id uuid NOT NULL,
    environment text NOT NULL,
    amount_minor integer NOT NULL,
    currency text NOT NULL,
    status text NOT NULL,
    capture_id text,
    capture_attempted_at timestamptz,
    approve_url text NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    CONSTRAINT paypal_order_environment CHECK (environment IN ('SANDBOX', 'LIVE')),
    CONSTRAINT paypal_order_amount_positive CHECK (amount_minor > 0),
    CONSTRAINT paypal_order_currency_code CHECK (currency ~ '^[A-Z]{3}$'),
    CONSTRAINT paypal_order_status CHECK (status IN ('CREATED', 'CAPTURED', 'LATE_CAPTURED', 'REJECTED', 'VOIDED'))
);
