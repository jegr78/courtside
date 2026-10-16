package org.courtside.booking.internal;

import org.courtside.facility.CourtClosure;
import org.courtside.facility.OpeningPeriod;
import org.courtside.facility.OpeningSchedule;
import org.courtside.shared.OpeningWindow;

import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Stream;

/** The hours and court closures a booking is held against, as the booking rules read them. */
record Availability(OpeningSchedule schedule, List<CourtClosure> closures) {

    Availability {
        closures = List.copyOf(closures);
    }

    Availability withPeriod(OpeningPeriod period) {
        return new Availability(new OpeningSchedule(schedule.weeks(),
                Stream.concat(otherPeriods(period.id()), Stream.of(period)).toList()), closures);
    }

    Availability withoutPeriod(UUID periodId) {
        return new Availability(new OpeningSchedule(schedule.weeks(), otherPeriods(periodId).toList()), closures);
    }

    Availability withClosure(CourtClosure closure) {
        return new Availability(schedule, Stream.concat(otherClosures(closure.id()), Stream.of(closure)).toList());
    }

    Availability withoutClosure(UUID closureId) {
        return new Availability(schedule, otherClosures(closureId).toList());
    }

    Optional<OpeningPeriod> period(UUID periodId) {
        return schedule.periods().stream().filter(period -> period.id().equals(periodId)).findFirst();
    }

    Optional<CourtClosure> closure(UUID closureId) {
        return closures.stream().filter(closure -> closure.id().equals(closureId)).findFirst();
    }

    boolean admits(List<BookedSlot> booking, ZoneId zone) {
        return booking.stream().allMatch(slot -> admits(slot, zone));
    }

    private boolean admits(BookedSlot slot, ZoneId zone) {
        ZonedDateTime start = slot.startsAt().atZone(zone);
        ZonedDateTime end = slot.endsAt().atZone(zone);
        Optional<OpeningWindow> window = schedule.windowOn(start.toLocalDate());
        return window.isPresent()
                && start.toLocalDate().equals(end.toLocalDate())
                && window.get().covers(start.toLocalTime(), end.toLocalTime())
                && closures.stream().noneMatch(closure -> closure.courtId().equals(slot.courtId())
                        && closure.covers(start.toLocalDate()));
    }

    private Stream<OpeningPeriod> otherPeriods(UUID periodId) {
        return schedule.periods().stream().filter(period -> !period.id().equals(periodId));
    }

    private Stream<CourtClosure> otherClosures(UUID closureId) {
        return closures.stream().filter(closure -> !closure.id().equals(closureId));
    }
}
