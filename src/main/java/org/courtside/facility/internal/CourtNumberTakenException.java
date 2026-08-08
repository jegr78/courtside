package org.courtside.facility.internal;

public class CourtNumberTakenException extends RuntimeException {

    public CourtNumberTakenException(String message, Throwable cause) {
        super(message, cause);
    }
}
