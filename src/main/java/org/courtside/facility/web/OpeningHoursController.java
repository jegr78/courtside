package org.courtside.facility.web;

import org.courtside.api.ApiBookingGrid;
import org.courtside.api.ApiOpeningHours;
import org.courtside.api.OpeningHoursApi;
import org.courtside.facility.FacilityService;
import org.courtside.config.BookingGridSettings;
import org.courtside.config.ClubTimeZone;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
class OpeningHoursController implements OpeningHoursApi {

    private final FacilityService facility;
    private final ClubTimeZone timeZone;
    private final BookingGridSettings bookingGridSettings;

    OpeningHoursController(FacilityService facility,
                           ClubTimeZone timeZone,
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
                timeZone.id(), bookingGridSettings.slotMinutes(), openingHours()));
    }

    private List<ApiOpeningHours> openingHours() {
        return facility.weeklyOpeningHours().stream()
                .map(hours -> FacilityAdminController.toResponse(
                        hours.dayOfWeek(), hours.opensAt(), hours.closesAt()))
                .toList();
    }
}
