package org.courtside.facility;

import org.courtside.shared.OpeningWindow;

import java.time.LocalDate;
import java.util.Comparator;
import java.util.List;
import java.util.Objects;
import java.util.Optional;

/**
 * Every version of the weekly opening hours, ordered by the day each takes effect. A date is
 * governed by the latest version that has started on it; before the first version every day is
 * closed.
 */
public record OpeningSchedule(List<OpeningWeek> weeks) {

    private static final Comparator<OpeningWeek> BY_START = Comparator.comparing(
            OpeningWeek::effectiveFrom, Comparator.nullsFirst(Comparator.naturalOrder()));

    public OpeningSchedule {
        weeks = weeks == null ? List.of()
                : weeks.stream().filter(Objects::nonNull).sorted(BY_START).toList();
    }

    public Optional<OpeningWeek> weekOn(LocalDate date) {
        return weeks.reversed().stream()
                .filter(week -> week.startsOnOrBefore(date))
                .findFirst();
    }

    public Optional<OpeningWindow> windowOn(LocalDate date) {
        return weekOn(date).flatMap(week -> week.windowOn(date.getDayOfWeek()));
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
