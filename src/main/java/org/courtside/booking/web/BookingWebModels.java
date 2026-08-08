package org.courtside.booking.web;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

final class BookingWebModels {

    private BookingWebModels() {
    }

    record CreateBookingRequest(
            @NotEmpty List<UUID> courtIds,
            @NotNull UUID cardId,
            @NotNull Instant startsAt,
            @NotNull Instant endsAt,
            String note,
            List<ParticipantRequest> participants) {
    }

    record ParticipantRequest(UUID personId, String guestName, UUID cardId) {
    }

    record BookingCreatedResponse(UUID id) {
    }

    record AllocationResponse(
            UUID bookingId,
            UUID courtId,
            Instant startsAt,
            Instant endsAt,
            String cardLabel,
            String cardColor,
            String bookedByName,
            String matchType) {
    }
}
