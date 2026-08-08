package org.courtside.booking.internal;

public class CourtUnavailableException extends RuntimeException {

    public CourtUnavailableException(String message, Throwable cause) {
        super(message, cause);
    }
}
