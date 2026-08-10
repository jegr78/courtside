package org.courtside.facility.web;

import org.courtside.api.ApiBookingGrid;
import org.courtside.api.ApiOpeningHours;
import org.courtside.api.OpeningHoursApi;
import org.courtside.facility.FacilityService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
class OpeningHoursController implements OpeningHoursApi {

    private final FacilityService facility;
    private final String timeZone;
    private final int slotMinutes;

    OpeningHoursController(FacilityService facility,
                           @Value("${courtside.booking.time-zone}") String timeZone,
                           @Value("${courtside.booking.slot-minutes}") int slotMinutes) {
        this.facility = facility;
        this.timeZone = timeZone;
        this.slotMinutes = slotMinutes;
    }

    @Override
    public ResponseEntity<List<ApiOpeningHours>> listOpeningHours() {
        return ResponseEntity.ok(openingHours());
    }

    @Override
    public ResponseEntity<ApiBookingGrid> getBookingGrid() {
        return ResponseEntity.ok(new ApiBookingGrid(timeZone, slotMinutes, openingHours()));
    }

    private List<ApiOpeningHours> openingHours() {
        return facility.weeklyOpeningHours().stream()
                .map(hours -> FacilityAdminController.toResponse(
                        hours.dayOfWeek(), hours.opensAt(), hours.closesAt()))
                .toList();
    }
}
