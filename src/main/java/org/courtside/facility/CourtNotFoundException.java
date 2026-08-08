package org.courtside.facility;

public class CourtNotFoundException extends RuntimeException {

    public CourtNotFoundException(String message) {
        super(message);
    }
}
