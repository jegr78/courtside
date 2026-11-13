package org.courtside.booking.web;

import lombok.RequiredArgsConstructor;
import org.courtside.api.DoorHoldApi;
import org.courtside.api.ApiBookingExtensionRequest;
import org.courtside.api.ApiDoorHold;
import org.courtside.booking.doorhold.DoorHoldService;
import org.courtside.booking.doorhold.DoorHoldService.DoorHold;
import org.courtside.identity.CurrentUser;
import org.courtside.identity.UserAccount;
import org.courtside.shared.WireTypes;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequiredArgsConstructor
class DoorHoldController implements DoorHoldApi {

    private final DoorHoldService doorHolds;
    private final CurrentUser currentUser;

    @Override
    public ResponseEntity<ApiDoorHold> holdDoorsOpen(UUID bookingId) {
        UserAccount account = currentUser.requireAccount();
        return ResponseEntity.ok(toResponse(doorHolds.start(bookingId, account.getId(), account.getRoles())));
    }

    @Override
    public ResponseEntity<Void> endDoorHold(UUID bookingId) {
        UserAccount account = currentUser.requireAccount();
        doorHolds.end(bookingId, account.getId(), account.getRoles());
        return ResponseEntity.noContent().build();
    }

    @Override
    public ResponseEntity<ApiDoorHold> extendHeldBooking(UUID bookingId, ApiBookingExtensionRequest request) {
        UserAccount account = currentUser.requireAccount();
        return ResponseEntity.ok(toResponse(doorHolds.extend(bookingId, request.getEndsAt().toInstant(),
                account.getId(), account.getRoles())));
    }

    static ApiDoorHold toResponse(DoorHold hold) {
        return new ApiDoorHold(WireTypes.toOffsetDateTime(hold.opensAt()), WireTypes.toOffsetDateTime(hold.closesAt()),
                hold.heldByMe())
                .heldSince(hold.heldSince() == null ? null : WireTypes.toOffsetDateTime(hold.heldSince()))
                .extensionEndsAt(hold.extensionEndsAt() == null ? null : WireTypes.toOffsetDateTime(hold.extensionEndsAt()));
    }
}
