package org.courtside.booking.internal;

import org.courtside.config.BookingGridConstraint;
import org.courtside.config.BookingSlotDuration;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.ZoneId;
import java.util.Optional;
import org.courtside.booking.BookingStatus;

@Component
class FutureBookingGridInspector implements BookingGridConstraint {

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
    public Optional<String> timeZoneConflictCode(ZoneId candidate) {
        return allocations.existsByStatusAndEndsAtAfter(BookingStatus.CONFIRMED, clock.instant())
                ? Optional.of("config.timeZone.futureBookingConflict")
                : Optional.empty();
    }
}
