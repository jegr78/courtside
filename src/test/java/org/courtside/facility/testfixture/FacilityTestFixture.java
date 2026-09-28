package org.courtside.facility.testfixture;

import lombok.RequiredArgsConstructor;
import org.courtside.facility.FacilityService;
import org.courtside.facility.internal.WeeklyOpeningHours;
import org.courtside.shared.OpeningWindow;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.Arrays;
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

    public long countCourts() {
        return facilityService.allCourts().size();
    }
}
