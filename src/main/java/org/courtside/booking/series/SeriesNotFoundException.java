package org.courtside.booking.series;

public class SeriesNotFoundException extends RuntimeException {

    public SeriesNotFoundException(String message) {
        super(message);
    }
}
