package org.courtside.notification.internal;

import org.courtside.shared.BookingAnnouncement;
import org.courtside.shared.BookingAnnouncer;

import java.util.UUID;

final class AnnouncedBooking {

    private AnnouncedBooking() {
    }

    static BookingAnnouncement current(BookingAnnouncer bookings, UUID bookingId) {
        BookingAnnouncement booking = existing(bookings, bookingId);
        if (booking.cancelled()) {
            throw new MessageUndeliverableException("BookingCancelled");
        }
        return booking;
    }

    static BookingAnnouncement existing(BookingAnnouncer bookings, UUID bookingId) {
        return bookings.describe(bookingId)
                .orElseThrow(() -> new MessageUndeliverableException("BookingGone"));
    }
}
