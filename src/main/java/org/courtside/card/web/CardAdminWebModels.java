package org.courtside.card.web;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.courtside.shared.NoDuplicates;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;

final class CardAdminWebModels {

    private CardAdminWebModels() {
    }

    record BookingCardResponse(
            UUID id,
            String label,
            String color,
            String requiredRole,
            List<Integer> allowedPlayerCounts,
            boolean tracksPlayers,
            boolean countsAgainstLimits,
            boolean guestAllowed,
            boolean active) {
    }

    record BookingCardRequest(
            @NotBlank @Size(max = 60) String label,
            @NotBlank @Pattern(regexp = "^#[0-9a-fA-F]{6}$") String color,
            @KnownRole String requiredRole,
            @NotNull @Size(max = 20) @NoDuplicates
            List<@NotNull @Min(1) @Max(20) Integer> allowedPlayerCounts,
            @NotNull Boolean countsAgainstLimits,
            @NotNull Boolean guestAllowed) {

        BookingCardRequest {
            // List.copyOf rejects a null element outright, turning it into a 500 before @NotNull can report it.
            allowedPlayerCounts = allowedPlayerCounts == null
                    ? List.of()
                    : Collections.unmodifiableList(new ArrayList<>(allowedPlayerCounts));
        }
    }

    record ParticipantCardResponse(UUID id, String label, Integer capacity, boolean active) {
    }

    record ParticipantCardRequest(
            @NotBlank @Size(max = 60) String label,
            @Min(1) @Max(99) Integer capacity) {
    }
}
