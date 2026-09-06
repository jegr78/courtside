package org.courtside.booking.internal;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.Map;

final class ReportingPeriod {

    private static final long MAX_DAYS = 366;

    private ReportingPeriod() {
    }

    static void validate(LocalDate from, LocalDate to) {
        if (from == null || to == null) {
            throw new IllegalStateException("A reporting period needs both dates");
        }
        if (isOutsideContractRange(from) || isOutsideContractRange(to)) {
            throw new FacilityUtilisationPeriodInvalidException(
                    "booking.facilityUtilisation.dateOutOfRange", Map.of());
        }
        if (to.isBefore(from)) {
            throw new FacilityUtilisationPeriodInvalidException(
                    "booking.facilityUtilisation.periodOrder", Map.of());
        }
        if (ChronoUnit.DAYS.between(from, to) + 1 > MAX_DAYS) {
            throw new FacilityUtilisationPeriodInvalidException(
                    "booking.facilityUtilisation.periodTooLong", Map.of("maxDays", MAX_DAYS));
        }
    }

    private static boolean isOutsideContractRange(LocalDate date) {
        return date.getYear() < 1 || date.getYear() > 9999;
    }
}
