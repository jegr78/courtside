package org.courtside.booking;

import java.util.List;
import java.util.UUID;

public record ParticipationPage(List<Booking> bookings, UUID nextCursor) {

    public ParticipationPage {
        bookings = bookings == null ? List.of() : List.copyOf(bookings);
    }
}
