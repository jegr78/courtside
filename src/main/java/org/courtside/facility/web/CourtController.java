package org.courtside.facility.web;

import org.courtside.api.ApiPublicCourt;
import org.courtside.api.CourtsApi;
import org.courtside.facility.Court;
import org.courtside.facility.FacilityService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequiredArgsConstructor
class CourtController implements CourtsApi {

    private final FacilityService facility;

    @Override
    public ResponseEntity<List<ApiPublicCourt>> listCourts() {
        return ResponseEntity.ok(facility.activeCourts().stream()
                .map(CourtController::toResponse)
                .toList());
    }

    private static ApiPublicCourt toResponse(Court court) {
        return new ApiPublicCourt(court.getId(), court.getNumber(), court.getName());
    }
}
