package org.courtside.booking.internal;

public class IdempotencyKeyRaceException extends RuntimeException {

    public IdempotencyKeyRaceException(Throwable cause) {
        super(cause);
    }
}
