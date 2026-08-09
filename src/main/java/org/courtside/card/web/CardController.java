package org.courtside.card.web;

import org.courtside.api.ApiPublicBookingCard;
import org.courtside.api.ApiPublicParticipantCard;
import org.courtside.api.CardsApi;
import org.courtside.card.BookingCard;
import org.courtside.card.CardService;
import org.courtside.card.ParticipantCard;
import lombok.RequiredArgsConstructor;
import org.courtside.identity.CurrentUser;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

@RestController
@RequiredArgsConstructor
class CardController implements CardsApi {

    private final CardService cards;
    private final CurrentUser currentUser;

    @Override
    public ResponseEntity<List<ApiPublicBookingCard>> listBookableCards() {
        return ResponseEntity.ok(cards.bookableCards(callerRoles()).stream()
                .map(CardController::toResponse)
                .toList());
    }

    @Override
    public ResponseEntity<List<ApiPublicParticipantCard>> listParticipantCards() {
        return ResponseEntity.ok(cards.activeParticipantCards().stream()
                .map(CardController::toResponse)
                .toList());
    }

    private Set<Role> callerRoles() {
        return currentUser.account().map(UserAccount::getRoles).orElseGet(Set::of);
    }

    private static ApiPublicBookingCard toResponse(BookingCard card) {
        return new ApiPublicBookingCard(card.getId(), card.getLabel(), card.getColor(),
                toPlayerCountList(card.getAllowedPlayerCounts()), card.isGuestAllowed());
    }

    private static ApiPublicParticipantCard toResponse(ParticipantCard card) {
        return new ApiPublicParticipantCard(card.getId(), card.getLabel())
                .capacity(card.getCapacity());
    }

    private static List<Integer> toPlayerCountList(short[] counts) {
        List<Integer> result = new ArrayList<>(counts.length);
        for (short count : counts) {
            result.add((int) count);
        }
        return result;
    }
}
