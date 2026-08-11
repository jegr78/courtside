package org.courtside.facility.web;

import org.courtside.api.ApiBookingGrid;
import org.courtside.api.ApiOpeningHours;
import org.courtside.api.OpeningHoursApi;
import org.courtside.facility.FacilityService;
import org.courtside.config.BookingGridSettings;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
class OpeningHoursController implements OpeningHoursApi {

    private final FacilityService facility;
    private final String timeZone;
    private final BookingGridSettings bookingGridSettings;

    OpeningHoursController(FacilityService facility,
                           @Value("${courtside.booking.time-zone}") String timeZone,
                           BookingGridSettings bookingGridSettings) {
        this.facility = facility;
        this.timeZone = timeZone;
        this.bookingGridSettings = bookingGridSettings;
    }

    @Override
    public ResponseEntity<List<ApiOpeningHours>> listOpeningHours() {
        return ResponseEntity.ok(openingHours());
    }

    @Override
    public ResponseEntity<ApiBookingGrid> getBookingGrid() {
        return ResponseEntity.ok(new ApiBookingGrid(
                timeZone, bookingGridSettings.slotMinutes(), openingHours()));
    }

    private List<ApiOpeningHours> openingHours() {
        return facility.weeklyOpeningHours().stream()
                .map(hours -> FacilityAdminController.toResponse(
                        hours.dayOfWeek(), hours.opensAt(), hours.closesAt()))
                .toList();
    }
}
