package org.courtside.facility.web;

import org.courtside.facility.Court;
import org.courtside.facility.FacilityService;
import org.courtside.facility.web.FacilityWebModels.PublicCourtResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequiredArgsConstructor
class CourtController {

    private final FacilityService facility;

    @GetMapping("/api/public/courts")
    List<PublicCourtResponse> courts() {
        return facility.activeCourts().stream()
                .map(CourtController::toResponse)
                .toList();
    }

    private static PublicCourtResponse toResponse(Court court) {
        return new PublicCourtResponse(court.getId(), court.getNumber(), court.getName());
    }
}
