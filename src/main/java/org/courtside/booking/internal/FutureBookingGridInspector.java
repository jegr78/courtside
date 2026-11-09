package org.courtside.booking.internal;

import org.courtside.booking.BookingStatus;
import org.courtside.config.BookingGridConstraint;
import org.courtside.config.BookingSlotDuration;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.ZoneId;
import java.util.Optional;
import java.util.Set;

@Component
class FutureBookingGridInspector implements BookingGridConstraint {

    private static final Set<BookingStatus> OCCUPYING = Set.of(BookingStatus.CONFIRMED, BookingStatus.PENDING_PAYMENT);

    private final CourtAllocationRepository allocations;
    private final Clock clock;

    FutureBookingGridInspector(CourtAllocationRepository allocations, Clock clock) {
        this.allocations = allocations;
        this.clock = clock;
    }

    @Override
    public Optional<String> conflictCode(BookingSlotDuration slotDuration, ZoneId timeZone) {
        return allocations.existsFutureConflictWithGrid(
                clock.instant(), timeZone.getId(), slotDuration.seconds())
                ? Optional.of("config.slotMinutes.futureBookingConflict")
                : Optional.empty();
    }

    @Override
    public Optional<String> timeZoneConflictCode() {
        return allocations.existsByStatusInAndEndsAtAfter(OCCUPYING, clock.instant())
                ? Optional.of("config.timeZone.futureBookingConflict")
                : Optional.empty();
    }
}
