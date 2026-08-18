package org.courtside.facility.testfixture;

import lombok.RequiredArgsConstructor;
import org.courtside.facility.FacilityService;
import org.courtside.shared.OpeningWindow;

import java.time.DayOfWeek;
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

    public long countCourts() {
        return facilityService.allCourts().size();
    }
}
