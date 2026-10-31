package org.courtside.access.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.facility.FacilityService;
import org.springframework.stereotype.Component;

import java.util.Optional;
import java.util.UUID;

/** The Loxone group a board mapped each access point onto, read from the access point itself. */
@Component
@RequiredArgsConstructor
class AccessPointLoxoneGroups implements LoxoneGroupMapping {

    private final FacilityService facility;

    @Override
    public Optional<String> groupOf(UUID accessPointId) {
        return facility.loxoneGroupOf(accessPointId);
    }
}
