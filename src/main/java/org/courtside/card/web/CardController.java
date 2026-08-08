package org.courtside.card.web;

import org.courtside.card.BookingCard;
import org.courtside.card.CardService;
import org.courtside.card.ParticipantCard;
import org.courtside.card.web.CardWebModels.PublicBookingCardResponse;
import org.courtside.card.web.CardWebModels.PublicParticipantCardResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

@RestController
@RequiredArgsConstructor
class CardController {

    private static final String ROLE_PREFIX = "ROLE_";

    private final CardService cards;

    @GetMapping("/api/public/booking-cards")
    List<PublicBookingCardResponse> bookingCards(Authentication authentication) {
        return cards.bookableCards(callerRoles(authentication)).stream()
                .map(CardController::toResponse)
                .toList();
    }

    @GetMapping("/api/public/participant-cards")
    List<PublicParticipantCardResponse> participantCards() {
        return cards.activeParticipantCards().stream()
                .map(CardController::toResponse)
                .toList();
    }

    private static Set<String> callerRoles(Authentication authentication) {
        if (authentication == null) {
            return Set.of();
        }
        return authentication.getAuthorities().stream()
                .map(GrantedAuthority::getAuthority)
                .filter(authority -> authority.startsWith(ROLE_PREFIX))
                .map(authority -> authority.substring(ROLE_PREFIX.length()))
                .collect(Collectors.toSet());
    }

    private static PublicBookingCardResponse toResponse(BookingCard card) {
        return new PublicBookingCardResponse(card.getId(), card.getLabel(), card.getColor(),
                toPlayerCountList(card.getAllowedPlayerCounts()), card.isGuestAllowed());
    }

    private static PublicParticipantCardResponse toResponse(ParticipantCard card) {
        return new PublicParticipantCardResponse(card.getId(), card.getLabel(), card.getCapacity());
    }

    private static List<Integer> toPlayerCountList(short[] counts) {
        List<Integer> result = new ArrayList<>(counts.length);
        for (short count : counts) {
            result.add((int) count);
        }
        return result;
    }
}
