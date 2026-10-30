package org.courtside.booking.web;

import lombok.RequiredArgsConstructor;
import org.courtside.api.AdminOccupancyKeyApi;
import org.courtside.api.ApiIssuedOccupancyKey;
import org.courtside.api.ApiOccupancyKeyStatus;
import org.courtside.booking.internal.OccupancyKeys;
import org.courtside.shared.WireTypes;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
class OccupancyKeyAdminController implements AdminOccupancyKeyApi {

    private final OccupancyKeys keys;

    @Override
    public ResponseEntity<ApiOccupancyKeyStatus> getOccupancyKeyStatus() {
        return ResponseEntity.ok(keys.createdAt()
                .map(createdAt -> new ApiOccupancyKeyStatus(true).createdAt(WireTypes.toOffsetDateTime(createdAt)))
                .orElseGet(() -> new ApiOccupancyKeyStatus(false)));
    }

    @Override
    public ResponseEntity<ApiIssuedOccupancyKey> createOccupancyKey() {
        OccupancyKeys.IssuedKey issued = keys.issue();
        return ResponseEntity.ok(new ApiIssuedOccupancyKey(issued.key(), WireTypes.toOffsetDateTime(issued.createdAt())));
    }

    @Override
    public ResponseEntity<Void> revokeOccupancyKey() {
        keys.revoke();
        return ResponseEntity.noContent().build();
    }
}
