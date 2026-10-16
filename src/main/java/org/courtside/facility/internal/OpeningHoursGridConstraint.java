package org.courtside.facility.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.config.BookingGridConstraint;
import org.courtside.config.BookingSlotDuration;
import org.courtside.facility.OpeningSchedule;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Optional;
import java.util.stream.Stream;

@Component
@RequiredArgsConstructor
class OpeningHoursGridConstraint implements BookingGridConstraint {

    private final OpeningSchedules schedules;
    private final Clock clock;

    @Override
    public Optional<String> conflictCode(BookingSlotDuration slotDuration, ZoneId timeZone) {
        LocalDate today = LocalDate.ofInstant(clock.instant(), timeZone);
        OpeningSchedule schedule = schedules.load();
        return Stream.concat(
                        schedule.inForceFrom(today).stream().flatMap(week -> week.days().values().stream()),
                        schedule.periods().stream().filter(period -> !period.endsOn().isBefore(today))
                                .flatMap(period -> period.days().values().stream()))
                .anyMatch(window -> !slotDuration.isAligned(window.opensAt())
                        || !slotDuration.isAligned(window.closesAt()))
                ? Optional.of("config.slotMinutes.openingHoursConflict")
                : Optional.empty();
    }
}
