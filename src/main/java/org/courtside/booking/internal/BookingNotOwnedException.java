package org.courtside.booking.internal;

public class BookingNotOwnedException extends RuntimeException {

    public BookingNotOwnedException(String message) {
        super(message);
    }
}
