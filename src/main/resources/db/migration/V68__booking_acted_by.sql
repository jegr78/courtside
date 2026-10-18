ALTER TABLE booking ADD COLUMN acted_by uuid;

ALTER TABLE booking DROP CONSTRAINT booking_pseudonymised_names_nobody;

ALTER TABLE booking
    ADD CONSTRAINT booking_pseudonymised_names_nobody
        CHECK (pseudonymised_at IS NULL
            OR (booked_by IS NULL AND cancelled_by IS NULL AND moved_by IS NULL AND acted_by IS NULL
                AND note IS NULL));

DROP INDEX booking_idempotency_by_account;

CREATE UNIQUE INDEX booking_idempotency_by_account
    ON booking (booked_by, coalesce(acted_by, booked_by), idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE INDEX booking_acted_by ON booking (acted_by) WHERE acted_by IS NOT NULL;
