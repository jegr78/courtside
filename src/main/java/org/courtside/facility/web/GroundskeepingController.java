package org.courtside.facility.web;

import lombok.RequiredArgsConstructor;
import org.courtside.api.ApiAccessPointCodes;
import org.courtside.api.GroundskeepingApi;
import org.courtside.facility.FacilityService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequiredArgsConstructor
class GroundskeepingController implements GroundskeepingApi {

    private final FacilityService facility;

    @Override
    public ResponseEntity<List<ApiAccessPointCodes>> listAccessPointCodes() {
        return ResponseEntity.ok(facility.readAccessPointCodes().stream()
                .map(accessPoint -> new ApiAccessPointCodes(accessPoint.getId(), accessPoint.getName(),
                        accessPoint.getStaticCode(), accessPoint.getEmergencyCode()))
                .toList());
    }
}
