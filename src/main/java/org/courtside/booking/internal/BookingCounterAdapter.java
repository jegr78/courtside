package org.courtside.booking.internal;

import org.courtside.booking.BookingRepository;
import org.courtside.rules.BookingCounter;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

@Component
@RequiredArgsConstructor
@Transactional(readOnly = true)
class BookingCounterAdapter implements BookingCounter {

    private final BookingRepository bookings;

    @Override
    public long countOpenBookingsOf(UUID userAccountId, Instant now) {
        return bookings.countOpenBookings(userAccountId, now);
    }

    @Override
    public Duration bookedTimeStartingBetween(UUID userAccountId, Instant from, Instant until) {
        return Duration.ofSeconds(bookings.secondsBookedStartingBetween(userAccountId, from, until));
    }

    @Override
    public boolean countsAgainstLimits(UUID cardId) {
        return bookings.cardCountsAgainstLimits(cardId).orElse(true);
    }
}
