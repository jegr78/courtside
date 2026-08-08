package org.courtside.card.web;

import org.courtside.card.BookingCard;
import org.courtside.card.CardService;
import org.courtside.card.ParticipantCard;
import org.courtside.card.web.CardWebModels.PublicBookingCardResponse;
import org.courtside.card.web.CardWebModels.PublicParticipantCardResponse;
import lombok.RequiredArgsConstructor;
import org.courtside.identity.CurrentUser;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

@RestController
@RequiredArgsConstructor
class CardController {

    private final CardService cards;
    private final CurrentUser currentUser;

    @GetMapping("/api/public/booking-cards")
    List<PublicBookingCardResponse> bookingCards() {
        return cards.bookableCards(callerRoles()).stream()
                .map(CardController::toResponse)
                .toList();
    }

    @GetMapping("/api/public/participant-cards")
    List<PublicParticipantCardResponse> participantCards() {
        return cards.activeParticipantCards().stream()
                .map(CardController::toResponse)
                .toList();
    }

    private Set<Role> callerRoles() {
        return currentUser.account().map(UserAccount::getRoles).orElseGet(Set::of);
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
