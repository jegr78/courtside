package org.courtside.facility.web;

import java.util.UUID;

final class FacilityWebModels {

    private FacilityWebModels() {
    }

    record PublicCourtResponse(UUID id, int number, String name) {
    }
}
