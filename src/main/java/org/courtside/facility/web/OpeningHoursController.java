package org.courtside.facility.web;

import org.courtside.facility.FacilityService;
import org.courtside.facility.web.FacilityAdminWebModels.OpeningHoursResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequiredArgsConstructor
class OpeningHoursController {

    private final FacilityService facility;

    @GetMapping("/api/public/opening-hours")
    List<OpeningHoursResponse> openingHours() {
        return facility.weeklyOpeningHours().stream()
                .map(hours -> new OpeningHoursResponse(
                        hours.dayOfWeek(), hours.opensAt(), hours.closesAt()))
                .toList();
    }
}
