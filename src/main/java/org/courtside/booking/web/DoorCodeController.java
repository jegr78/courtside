package org.courtside.booking.web;

import lombok.RequiredArgsConstructor;
import org.courtside.api.ApiAccessCode;
import org.courtside.api.DoorCodesApi;
import org.courtside.facility.FacilityService;
import org.courtside.identity.CurrentUser;
import org.courtside.shared.DoorCodeAudience;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequiredArgsConstructor
class DoorCodeController implements DoorCodesApi {

    private final CurrentUser currentUser;
    private final DoorCodeAudience audience;
    private final FacilityService facility;

    @Override
    public ResponseEntity<List<ApiAccessCode>> listMembersDoorCodes() {
        if (!audience.includes(currentUser.requireAccount().getId())) {
            return ResponseEntity.ok(List.of());
        }
        return ResponseEntity.ok(facility.membersDoorCodes().stream()
                .map(door -> new ApiAccessCode(door.getName(), door.getStaticCode()))
                .toList());
    }
}
