package org.courtside.facility.web;

import org.courtside.api.ApiOpeningHours;
import org.courtside.api.OpeningHoursApi;
import org.courtside.facility.FacilityService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequiredArgsConstructor
class OpeningHoursController implements OpeningHoursApi {

    private final FacilityService facility;

    @Override
    public ResponseEntity<List<ApiOpeningHours>> listOpeningHours() {
        return ResponseEntity.ok(facility.weeklyOpeningHours().stream()
                .map(hours -> FacilityAdminController.toResponse(
                        hours.dayOfWeek(), hours.opensAt(), hours.closesAt()))
                .toList());
    }
}
