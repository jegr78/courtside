package org.courtside.booking;

import java.util.List;
import java.util.UUID;

public record PersonalBookingPage(List<Booking> bookings, UUID nextCursor) {

    public PersonalBookingPage {
        bookings = List.copyOf(bookings);
    }
}
