package org.courtside.reporting.internal;

import java.time.LocalDate;
import java.time.YearMonth;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.Optional;

public record StatisticsPeriod(LocalDate from, LocalDate to) {

    static StatisticsPeriod resolve(LocalDate from, LocalDate to, LocalDate today) {
        if (from == null && to == null) {
            YearMonth lastMonth = YearMonth.from(today).minusMonths(1);
            return new StatisticsPeriod(lastMonth.atDay(1), lastMonth.atEndOfMonth());
        }
        if (from == null || to == null) {
            throw new StatisticsPeriodInvalidException("reporting.statistics.periodIncomplete", Map.of());
        }
        if (isOutsideContractRange(from) || isOutsideContractRange(to)) {
            throw new StatisticsPeriodInvalidException("reporting.statistics.dateOutOfRange", Map.of());
        }
        if (to.isBefore(from)) {
            throw new StatisticsPeriodInvalidException("reporting.statistics.periodOrder", Map.of());
        }
        return new StatisticsPeriod(from, to);
    }

    Optional<StatisticsPeriod> previous() {
        long days = ChronoUnit.DAYS.between(from, to) + 1;
        LocalDate previousFrom = from.minusDays(days);
        if (isOutsideContractRange(previousFrom)) {
            return Optional.empty();
        }
        return Optional.of(new StatisticsPeriod(previousFrom, from.minusDays(1)));
    }

    private static boolean isOutsideContractRange(LocalDate date) {
        return date.getYear() < 1 || date.getYear() > 9999;
    }
}
