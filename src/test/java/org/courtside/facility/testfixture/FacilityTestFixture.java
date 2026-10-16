package org.courtside.facility.testfixture;

import lombok.RequiredArgsConstructor;
import org.courtside.facility.FacilityService;
import org.courtside.facility.OpeningPeriod;
import org.courtside.facility.internal.WeeklyOpeningHours;
import org.courtside.shared.OpeningWindow;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@RequiredArgsConstructor
public class FacilityTestFixture {

    private final FacilityService facilityService;

    public UUID createCourt(int number, String name) {
        return facilityService.createCourt(number, name).getId();
    }

    public UUID createInactiveCourt(int number, String name) {
        UUID courtId = createCourt(number, name);
        deactivateCourt(courtId);
        return courtId;
    }

    public void deactivateCourt(UUID courtId) {
        facilityService.setCourtActive(courtId, false);
    }

    public void setOpeningHours(DayOfWeek day, OpeningWindow window) {
        facilityService.setOpeningHours(day, window);
    }

    /** Schedules a week from {@code effectiveFrom}; weekdays missing from {@code open} are closed. */
    public void scheduleOpeningHours(LocalDate effectiveFrom, Map<DayOfWeek, OpeningWindow> open) {
        facilityService.scheduleOpeningHours(effectiveFrom, Arrays.stream(DayOfWeek.values())
                .map(day -> Optional.ofNullable(open.get(day))
                        .map(window -> new WeeklyOpeningHours(day, window.opensAt(), window.closesAt()))
                        .orElseGet(() -> new WeeklyOpeningHours(day, null, null)))
                .toList());
    }

    /** A season from {@code startsOn} to {@code endsOn}; weekdays missing from {@code open} are closed. */
    public UUID addSeason(LocalDate startsOn, LocalDate endsOn, Map<DayOfWeek, OpeningWindow> open) {
        return facilityService.createOpeningPeriod(OpeningPeriod.Kind.SEASON, "Season", startsOn, endsOn,
                week(open)).id();
    }

    /** A holiday on {@code date}, closed without a window. */
    public UUID addHoliday(LocalDate date, OpeningWindow window) {
        return facilityService.createOpeningPeriod(OpeningPeriod.Kind.HOLIDAY, "Holiday", date, date,
                week(window == null ? Map.of() : Map.of(date.getDayOfWeek(), window))).id();
    }

    public UUID closeCourt(UUID courtId, LocalDate startsOn, LocalDate endsOn) {
        return facilityService.createCourtClosure(courtId, "Closure", startsOn, endsOn).id();
    }

    private static List<WeeklyOpeningHours> week(Map<DayOfWeek, OpeningWindow> open) {
        return Arrays.stream(DayOfWeek.values())
                .map(day -> Optional.ofNullable(open.get(day))
                        .map(window -> new WeeklyOpeningHours(day, window.opensAt(), window.closesAt()))
                        .orElseGet(() -> new WeeklyOpeningHours(day, null, null)))
                .toList();
    }

    public long countCourts() {
        return facilityService.allCourts().size();
    }
}
