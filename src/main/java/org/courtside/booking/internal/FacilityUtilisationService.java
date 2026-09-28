package org.courtside.booking.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.config.ClubTimeZone;
import org.courtside.facility.FacilityService;
import org.courtside.facility.OpeningSchedule;
import org.courtside.shared.OpeningWindow;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class FacilityUtilisationService {

    private final CourtAllocationRepository allocations;
    // PostgreSQL reads a timestamp literal only within these years, and the period's edges may leave them in UTC.
    private static final Instant EARLIEST_LITERAL = Instant.parse("0001-01-01T00:00:00Z");
    private static final Instant LATEST_LITERAL = Instant.parse("9999-12-31T23:59:59.999999Z");

    private final FacilityService facility;
    private final ClubTimeZone clubTimeZone;
    private final Clock clock;

    public FacilityUtilisation report(LocalDate from, LocalDate to) {
        ZoneId zone = clubTimeZone.zoneId();
        ReportingPeriod period = ReportingPeriod.resolve(from, to, LocalDate.ofInstant(clock.instant(), zone));
        Instant startsAt = period.from().atStartOfDay(zone).toInstant();
        Instant endsAt = period.to().plusDays(1).atStartOfDay(zone).toInstant();
        List<OpenInterval> openTime = openTime(period, zone);
        long openMinutes = openTime.stream()
                .mapToLong(interval -> Duration.between(interval.opensAt(), interval.closesAt()).toSeconds())
                .sum() / 60;
        List<CourtUtilisation> courts = allocations.facilityUtilisation(startsAt, endsAt, multirange(openTime))
                .stream()
                .map(row -> toCourtUtilisation(row, openMinutes))
                .toList();
        return new FacilityUtilisation(period.from(), period.to(), zone.getId(), openMinutes, courts);
    }

    private List<OpenInterval> openTime(ReportingPeriod period, ZoneId zone) {
        OpeningSchedule schedule = facility.openingSchedule();
        List<OpenInterval> intervals = new ArrayList<>();
        for (LocalDate date = period.from(); !date.isAfter(period.to()); date = date.plusDays(1)) {
            Optional<OpeningWindow> hours = schedule.windowOn(date);
            if (hours.isEmpty()) {
                continue;
            }
            Instant opensAt = date.atTime(hours.get().opensAt()).atZone(zone).toInstant();
            Instant closesAt = date.atTime(hours.get().closesAt()).atZone(zone).toInstant();
            // A window inside a daylight-saving gap resolves to an empty or inverted interval.
            if (closesAt.isAfter(opensAt)) {
                intervals.add(new OpenInterval(opensAt, closesAt));
            }
        }
        return intervals;
    }

    private static String multirange(List<OpenInterval> intervals) {
        return intervals.stream()
                .map(interval -> new OpenInterval(latest(interval.opensAt(), EARLIEST_LITERAL),
                        earliest(interval.closesAt(), LATEST_LITERAL)))
                .filter(interval -> interval.closesAt().isAfter(interval.opensAt()))
                .map(interval -> "[" + interval.opensAt() + "," + interval.closesAt() + ")")
                .collect(Collectors.joining(",", "{", "}"));
    }

    private static Instant latest(Instant first, Instant second) {
        return first.isAfter(second) ? first : second;
    }

    private static Instant earliest(Instant first, Instant second) {
        return first.isBefore(second) ? first : second;
    }

    private static CourtUtilisation toCourtUtilisation(CourtUtilisationRow row, long openMinutes) {
        Double occupancy = openMinutes == 0 ? null : (double) row.getOccupiedOpenMinutes() / openMinutes;
        return new CourtUtilisation(row.getCourtId(), row.getCourtNumber(), row.getCourtName(),
                row.getBookingCount(), row.getOccupiedMinutes(), row.getOccupiedOpenMinutes(), occupancy);
    }

    private record OpenInterval(Instant opensAt, Instant closesAt) {
    }

    public record FacilityUtilisation(
            LocalDate from, LocalDate to, String timeZone, long openMinutes,
            List<CourtUtilisation> courts) {
    }

    public record CourtUtilisation(
            UUID courtId, int courtNumber, String courtName, long bookingCount,
            long occupiedMinutes, long occupiedOpenMinutes, Double occupancy) {
    }
}
