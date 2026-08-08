package org.courtside.booking.web;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

final class ImpactWebModels {

    private ImpactWebModels() {
    }

    record AffectedBookingResponse(UUID bookingId, List<UUID> courtIds, Instant startsAt, Instant endsAt) {
    }

    record ImpactResponse(int affectedCount, boolean truncated, List<AffectedBookingResponse> bookings) {
    }
}
