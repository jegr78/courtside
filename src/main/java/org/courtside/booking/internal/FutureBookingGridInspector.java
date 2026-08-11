package org.courtside.booking.internal;

import org.courtside.config.BookingGridConstraint;
import org.courtside.config.BookingSlotDuration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.util.Optional;

@Component
class FutureBookingGridInspector implements BookingGridConstraint {

    private final CourtAllocationRepository allocations;
    private final Clock clock;

    private final String timeZone;

    FutureBookingGridInspector(CourtAllocationRepository allocations, Clock clock,
                               @Value("${courtside.booking.time-zone}") String timeZone) {
        this.allocations = allocations;
        this.clock = clock;
        this.timeZone = timeZone;
    }

    @Override
    public Optional<String> conflictCode(BookingSlotDuration slotDuration) {
        return allocations.existsFutureConflictWithGrid(
                clock.instant(), timeZone, slotDuration.seconds())
                ? Optional.of("config.slotMinutes.futureBookingConflict")
                : Optional.empty();
    }
}
