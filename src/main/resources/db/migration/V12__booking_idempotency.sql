ALTER TABLE booking
    ADD COLUMN idempotency_key text,
    ADD COLUMN request_fingerprint varchar(64),
    ADD CONSTRAINT booking_idempotency_complete CHECK (
        (idempotency_key IS NULL) = (request_fingerprint IS NULL)
    ),
    ADD CONSTRAINT booking_idempotency_key_length CHECK (
        idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 128
    );

CREATE UNIQUE INDEX booking_idempotency_by_account
    ON booking (booked_by, idempotency_key)
    WHERE idempotency_key IS NOT NULL;
