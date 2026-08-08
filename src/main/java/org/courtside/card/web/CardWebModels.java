package org.courtside.card.web;

import java.util.List;
import java.util.UUID;

final class CardWebModels {

    private CardWebModels() {
    }

    record PublicBookingCardResponse(
            UUID id,
            String label,
            String color,
            List<Integer> allowedPlayerCounts,
            boolean guestAllowed) {
    }

    record PublicParticipantCardResponse(UUID id, String label, Integer capacity) {
    }
}
