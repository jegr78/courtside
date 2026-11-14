package org.courtside.facility.web;

import lombok.RequiredArgsConstructor;
import org.courtside.api.ApiDoorCode;
import org.courtside.api.GroundsApi;
import org.courtside.facility.FacilityService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequiredArgsConstructor
class DoorCodeReadController implements GroundsApi {

    private final FacilityService facility;

    @Override
    public ResponseEntity<List<ApiDoorCode>> readDoorCodes() {
        return ResponseEntity.ok(facility.readDoorCodes().stream()
                .map(door -> new ApiDoorCode(door.getId(), door.getName(), door.getStaticCode(),
                        door.getEmergencyCode()))
                .toList());
    }
}
