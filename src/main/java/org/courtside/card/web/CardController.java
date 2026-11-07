package org.courtside.card.web;

import org.courtside.api.ApiBookingCardLegendEntry;
import org.courtside.api.ApiPublicBookingCard;
import org.courtside.api.ApiPublicParticipantCard;
import org.courtside.api.CardsApi;
import org.courtside.card.BookingCard;
import org.courtside.card.CardService;
import org.courtside.card.ParticipantCard;
import lombok.RequiredArgsConstructor;
import org.courtside.identity.CurrentUser;
import org.courtside.identity.UserAccount;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.List;

@RestController
@RequiredArgsConstructor
class CardController implements CardsApi {

    private final CardService cards;
    private final CurrentUser currentUser;

    @Override
    public ResponseEntity<List<ApiPublicBookingCard>> listBookableCards() {
        return ResponseEntity.ok(currentUser.account()
                .map(account -> cards.bookableCards(account.getId(), account.getRoles()))
                .orElseGet(List::of).stream()
                .map(CardController::toResponse)
                .toList());
    }

    @Override
    public ResponseEntity<List<ApiBookingCardLegendEntry>> listBookingCardLegend() {
        List<BookingCard> activeCards = cards.activeCards();
        List<ApiBookingCardLegendEntry> legend = new ArrayList<>(activeCards.stream()
                .filter(card -> !card.isShowGenericOccupancy())
                .map(card -> new ApiBookingCardLegendEntry(card.getId(), card.getLabel(), card.getColor(), false))
                .toList());
        if (activeCards.stream().anyMatch(BookingCard::isShowGenericOccupancy)) {
            legend.add(new ApiBookingCardLegendEntry(null, "?", "#999999", true));
        }
        return ResponseEntity.ok(legend);
    }

    @Override
    public ResponseEntity<List<ApiPublicParticipantCard>> listParticipantCards() {
        UserAccount account = currentUser.requireAccount();
        return ResponseEntity.ok(cards.activeParticipantCardsFor(account.getId(), account.getRoles()).stream()
                .map(CardController::toResponse)
                .toList());
    }

    private static ApiPublicBookingCard toResponse(BookingCard card) {
        return new ApiPublicBookingCard(card.getId(), card.getLabel(), card.getColor(),
                toPlayerCountList(card.getAllowedPlayerCounts()), card.isGuestAllowed(), card.getGuestFeeMinor(),
                card.getExternalPriceMinor());
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
