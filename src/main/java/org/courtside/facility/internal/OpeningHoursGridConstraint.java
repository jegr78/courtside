package org.courtside.facility.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.config.BookingGridConstraint;
import org.courtside.config.BookingSlotDuration;
import org.courtside.facility.OpeningHoursRepository;
import org.springframework.stereotype.Component;

import java.util.Optional;

@Component
@RequiredArgsConstructor
class OpeningHoursGridConstraint implements BookingGridConstraint {

    private final OpeningHoursRepository openingHours;

    @Override
    public Optional<String> conflictCode(BookingSlotDuration slotDuration, java.time.ZoneId timeZone) {
        return openingHours.findAll().stream()
                .anyMatch(hours -> !slotDuration.isAligned(hours.getOpensAt())
                        || !slotDuration.isAligned(hours.getClosesAt()))
                ? Optional.of("config.slotMinutes.openingHoursConflict")
                : Optional.empty();
    }
}
