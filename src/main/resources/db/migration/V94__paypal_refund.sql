ALTER TABLE credit_entry
    DROP CONSTRAINT credit_entry_kind_sign,
    DROP CONSTRAINT credit_entry_amount_bounded,
    DROP CONSTRAINT credit_entry_booking_reference,
    DROP CONSTRAINT credit_entry_paypal_order_reference,
    ADD CONSTRAINT credit_entry_kind_sign CHECK (
        (kind IN ('CREDIT', 'BOOKING_REFUND', 'PAYPAL_PAYMENT', 'PAYPAL_LATE_CAPTURE', 'PAYPAL_REFUND_REVERSED')
            AND amount_minor > 0)
        OR (kind IN ('PAYOUT', 'BOOKING_DEBIT', 'PAYPAL_REFUND') AND amount_minor < 0)),
    ADD CONSTRAINT credit_entry_amount_bounded CHECK (
        kind IN ('BOOKING_DEBIT', 'BOOKING_REFUND', 'PAYPAL_PAYMENT', 'PAYPAL_LATE_CAPTURE', 'PAYPAL_REFUND',
                 'PAYPAL_REFUND_REVERSED')
        OR amount_minor BETWEEN -1000000 AND 1000000),
    ADD CONSTRAINT credit_entry_booking_reference CHECK (
        (kind IN ('BOOKING_DEBIT', 'BOOKING_REFUND', 'PAYPAL_PAYMENT', 'PAYPAL_LATE_CAPTURE', 'PAYPAL_REFUND',
                  'PAYPAL_REFUND_REVERSED'))
            = (booking_id IS NOT NULL)),
    ADD CONSTRAINT credit_entry_paypal_order_reference CHECK (
        (kind IN ('PAYPAL_PAYMENT', 'PAYPAL_LATE_CAPTURE', 'PAYPAL_REFUND', 'PAYPAL_REFUND_REVERSED'))
            = (paypal_order_id IS NOT NULL));

DROP INDEX credit_entry_paypal_order;

CREATE UNIQUE INDEX credit_entry_paypal_order ON credit_entry (paypal_order_id)
    WHERE kind IN ('PAYPAL_PAYMENT', 'PAYPAL_LATE_CAPTURE');

CREATE UNIQUE INDEX credit_entry_paypal_order_kind ON credit_entry (paypal_order_id, kind)
    WHERE paypal_order_id IS NOT NULL;

CREATE TABLE paypal_refund (
    id uuid PRIMARY KEY,
    order_id text NOT NULL,
    account_id uuid NOT NULL,
    amount_minor integer NOT NULL,
    currency text NOT NULL,
    status text NOT NULL,
    refund_id text,
    failure_reason text,
    requested_by uuid NOT NULL,
    requested_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    CONSTRAINT paypal_refund_one_per_order UNIQUE (order_id),
    CONSTRAINT paypal_refund_order FOREIGN KEY (order_id) REFERENCES paypal_order (order_id),
    CONSTRAINT paypal_refund_amount_positive CHECK (amount_minor > 0),
    CONSTRAINT paypal_refund_currency_code CHECK (currency ~ '^[A-Z]{3}$'),
    CONSTRAINT paypal_refund_status CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED')),
    CONSTRAINT paypal_refund_completed_has_id CHECK (status <> 'COMPLETED' OR refund_id IS NOT NULL),
    CONSTRAINT paypal_refund_failure_reason CHECK ((status = 'FAILED') = (failure_reason IS NOT NULL)),
    CONSTRAINT paypal_refund_failure_reason_length CHECK (length(btrim(failure_reason)) BETWEEN 1 AND 200)
);
