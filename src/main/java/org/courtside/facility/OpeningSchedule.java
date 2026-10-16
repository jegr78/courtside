package org.courtside.facility;

import org.courtside.shared.OpeningWindow;

import java.time.LocalDate;
import java.util.Comparator;
import java.util.List;
import java.util.Objects;
import java.util.Optional;

/**
 * Every version of the weekly opening hours, ordered by the day each takes effect, and the seasons
 * and holidays that replace them. A date is governed by a holiday covering it, then by a season,
 * then by the latest weekly version that has started on it; before the first version every day is
 * closed.
 */
public record OpeningSchedule(List<OpeningWeek> weeks, List<OpeningPeriod> periods) {

    private static final Comparator<OpeningWeek> BY_START = Comparator.comparing(
            OpeningWeek::effectiveFrom, Comparator.nullsFirst(Comparator.naturalOrder()));

    public OpeningSchedule {
        weeks = weeks == null ? List.of()
                : weeks.stream().filter(Objects::nonNull).sorted(BY_START).toList();
        periods = periods == null ? List.of()
                : periods.stream().filter(Objects::nonNull).sorted(Comparator.comparing(OpeningPeriod::startsOn)).toList();
    }

    public OpeningSchedule(List<OpeningWeek> weeks) {
        this(weeks, List.of());
    }

    public Optional<OpeningWeek> weekOn(LocalDate date) {
        return weeks.reversed().stream()
                .filter(week -> week.startsOnOrBefore(date))
                .findFirst();
    }

    public Optional<OpeningWindow> windowOn(LocalDate date) {
        return periodOn(date, OpeningPeriod.Kind.HOLIDAY)
                .or(() -> periodOn(date, OpeningPeriod.Kind.SEASON))
                .map(period -> period.windowOn(date))
                .orElseGet(() -> weekOn(date).flatMap(week -> week.windowOn(date.getDayOfWeek())));
    }

    private Optional<OpeningPeriod> periodOn(LocalDate date, OpeningPeriod.Kind kind) {
        return periods.stream().filter(period -> period.kind() == kind && period.covers(date)).findFirst();
    }

    public Optional<LocalDate> nextChangeAfter(LocalDate date) {
        return weeks.stream()
                .map(OpeningWeek::effectiveFrom)
                .filter(start -> start != null && start.isAfter(date))
                .findFirst();
    }

    /** The version in force on {@code date} followed by every version scheduled after it. */
    public List<OpeningWeek> inForceFrom(LocalDate date) {
        Optional<OpeningWeek> current = weekOn(date);
        return weeks.stream()
                .filter(week -> current.map(week::equals).orElse(false)
                        || (week.effectiveFrom() != null && week.effectiveFrom().isAfter(date)))
                .toList();
    }
}
