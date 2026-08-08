package org.courtside.booking.series;

import java.time.LocalTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;

public record MoveRequest(
        UUID seriesId,
        UUID fromBookingId,
        CancelScope scope,
        LocalTime newStartTime,
        Integer newDurationMinutes,
        List<UUID> newCourtIds) {

    public MoveRequest {
        if (seriesId == null) {
            throw new IllegalArgumentException("seriesId must not be null");
        }
        if (fromBookingId == null) {
            throw new IllegalArgumentException("fromBookingId must not be null");
        }
        if (scope == null) {
            throw new IllegalArgumentException("scope must not be null");
        }
        if (newDurationMinutes != null && newDurationMinutes <= 0) {
            throw new IllegalArgumentException("newDurationMinutes must be positive");
        }
        newCourtIds = newCourtIds == null ? null : List.copyOf(newCourtIds);
        if (newCourtIds != null && newCourtIds.isEmpty()) {
            throw new IllegalArgumentException("newCourtIds must not be empty");
        }
        if (newCourtIds != null && Set.copyOf(newCourtIds).size() != newCourtIds.size()) {
            throw new IllegalArgumentException("newCourtIds must not contain the same court twice");
        }
        if (newStartTime == null && newDurationMinutes == null && newCourtIds == null) {
            throw new IllegalArgumentException("A move must change the time, the duration or the courts");
        }
    }
}
