package org.courtside.facility.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.config.BookingGridConstraint;
import org.courtside.config.BookingSlotDuration;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Optional;

@Component
@RequiredArgsConstructor
class OpeningHoursGridConstraint implements BookingGridConstraint {

    private final OpeningSchedules schedules;
    private final Clock clock;

    @Override
    public Optional<String> conflictCode(BookingSlotDuration slotDuration, ZoneId timeZone) {
        return schedules.load().inForceFrom(LocalDate.ofInstant(clock.instant(), timeZone)).stream()
                .flatMap(week -> week.days().values().stream())
                .anyMatch(window -> !slotDuration.isAligned(window.opensAt())
                        || !slotDuration.isAligned(window.closesAt()))
                ? Optional.of("config.slotMinutes.openingHoursConflict")
                : Optional.empty();
    }
}
