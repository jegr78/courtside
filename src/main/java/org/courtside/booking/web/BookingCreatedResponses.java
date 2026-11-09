package org.courtside.booking.web;

import org.courtside.api.ApiBookingCreated;
import org.courtside.api.ApiBookingStatus;
import org.courtside.booking.Booking;
import org.courtside.booking.BookingStatus;
import org.courtside.shared.WireTypes;

final class BookingCreatedResponses {

    private BookingCreatedResponses() {
    }

    static ApiBookingCreated of(Booking booking) {
        return new ApiBookingCreated(booking.getId(), ApiBookingStatus.fromValue(booking.getStatus().name()))
                .paymentExpiresAt(booking.getStatus() == BookingStatus.PENDING_PAYMENT
                        ? booking.paymentExpiresAt().map(WireTypes::toOffsetDateTime).orElse(null) : null);
    }
}
