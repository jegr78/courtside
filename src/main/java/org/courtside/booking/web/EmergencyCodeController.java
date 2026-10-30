package org.courtside.booking.web;

import lombok.RequiredArgsConstructor;
import org.courtside.api.ApiAccessCode;
import org.courtside.api.ApiEmergencyAccess;
import org.courtside.api.EmergencyCodesApi;
import org.courtside.booking.internal.EmergencyCodes;
import org.courtside.identity.CurrentUser;
import org.courtside.identity.UserAccount;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequiredArgsConstructor
class EmergencyCodeController implements EmergencyCodesApi {

    private final EmergencyCodes emergencyCodes;
    private final CurrentUser currentUser;

    @Override
    public ResponseEntity<ApiEmergencyAccess> requestEmergencyCode(UUID bookingId) {
        return answer(bookingId);
    }

    @Override
    public ResponseEntity<ApiEmergencyAccess> requestParticipationEmergencyCode(UUID bookingId) {
        return answer(bookingId);
    }

    private ResponseEntity<ApiEmergencyAccess> answer(UUID bookingId) {
        UserAccount account = currentUser.requireAccount();
        UUID personId = account.getPerson() == null ? null : account.getPerson().getId();
        return ResponseEntity.ok(new ApiEmergencyAccess(emergencyCodes.request(bookingId, account.getId(), personId)
                .stream().map(code -> new ApiAccessCode(code.accessPointName(), code.code())).toList()));
    }
}
