package org.courtside.notification.internal;

import org.courtside.shared.BookingAnnouncement;
import org.courtside.shared.BookingAnnouncer;

import java.util.UUID;

final class AnnouncedBooking {

    private AnnouncedBooking() {
    }

    static BookingAnnouncement current(BookingAnnouncer bookings, UUID bookingId) {
        BookingAnnouncement booking = bookings.describe(bookingId)
                .orElseThrow(() -> new MessageUndeliverableException("BookingGone"));
        if (booking.cancelled()) {
            throw new MessageUndeliverableException("BookingCancelled");
        }
        return booking;
    }
}
