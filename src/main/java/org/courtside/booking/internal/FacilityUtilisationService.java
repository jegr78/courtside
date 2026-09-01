package org.courtside.booking.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.config.ClubTimeZone;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class FacilityUtilisationService {

    private static final long MAX_PERIOD_DAYS = 366;

    private final CourtAllocationRepository allocations;
    private final ClubTimeZone clubTimeZone;

    public FacilityUtilisation report(LocalDate from, LocalDate to) {
        validatePeriod(from, to);
        ZoneId zone = clubTimeZone.zoneId();
        Instant startsAt = from.atStartOfDay(zone).toInstant();
        Instant endsAt = to.plusDays(1).atStartOfDay(zone).toInstant();
        List<CourtUtilisation> courts = allocations.facilityUtilisation(startsAt, endsAt).stream()
                .map(FacilityUtilisationService::toCourtUtilisation)
                .toList();
        return new FacilityUtilisation(from, to, zone.getId(), courts);
    }

    private static void validatePeriod(LocalDate from, LocalDate to) {
        if (from == null || to == null) {
            throw new IllegalStateException("A facility utilisation period needs both dates");
        }
        if (isOutsideContractRange(from) || isOutsideContractRange(to)) {
            throw new FacilityUtilisationPeriodInvalidException(
                    "booking.facilityUtilisation.dateOutOfRange", Map.of());
        }
        if (to.isBefore(from)) {
            throw new FacilityUtilisationPeriodInvalidException(
                    "booking.facilityUtilisation.periodOrder", Map.of());
        }
        long days = ChronoUnit.DAYS.between(from, to) + 1;
        if (days > MAX_PERIOD_DAYS) {
            throw new FacilityUtilisationPeriodInvalidException(
                    "booking.facilityUtilisation.periodTooLong",
                    Map.of("maxDays", MAX_PERIOD_DAYS));
        }
    }

    private static boolean isOutsideContractRange(LocalDate date) {
        return date.getYear() < 1 || date.getYear() > 9999;
    }

    private static CourtUtilisation toCourtUtilisation(CourtUtilisationRow row) {
        return new CourtUtilisation(row.getCourtId(), row.getCourtNumber(), row.getCourtName(),
                row.getBookingCount(), row.getOccupiedMinutes());
    }

    public record FacilityUtilisation(
            LocalDate from, LocalDate to, String timeZone, List<CourtUtilisation> courts) {
    }

    public record CourtUtilisation(
            UUID courtId, int courtNumber, String courtName, long bookingCount,
            long occupiedMinutes) {
    }
}
