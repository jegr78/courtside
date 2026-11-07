package org.courtside.booking.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.booking.BookingRepository;
import org.courtside.shared.UpcomingBookings;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.util.UUID;

@Component
@RequiredArgsConstructor
class OwnUpcomingBookings implements UpcomingBookings {

    private final BookingRepository bookings;
    private final Clock clock;

    @Override
    @Transactional(readOnly = true)
    public boolean heldBy(UUID accountId) {
        return accountId != null && bookings.existsUpcomingBookedBy(accountId, clock.instant());
    }
}
