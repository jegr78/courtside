package org.courtside.booking.web;

import lombok.RequiredArgsConstructor;
import org.courtside.api.PartnerSearchApi;
import org.courtside.api.ApiOpenPlace;
import org.courtside.booking.partner.PartnerSearchService;
import org.courtside.card.BookingCard;
import org.courtside.card.CardService;
import org.courtside.identity.CurrentUser;
import org.courtside.identity.UserAccount;
import org.courtside.shared.WireTypes;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

@RestController
@RequiredArgsConstructor
class PartnerSearchController implements PartnerSearchApi {

    private final PartnerSearchService partnerSearch;
    private final CurrentUser currentUser;
    private final CardService cards;

    @Override
    public ResponseEntity<Void> publishPartnerInvitation(UUID bookingId) {
        partnerSearch.publish(bookingId, currentUser.requireAccount().getId());
        return ResponseEntity.noContent().build();
    }

    @Override
    public ResponseEntity<Void> withdrawPartnerInvitation(UUID bookingId) {
        partnerSearch.withdraw(bookingId, currentUser.requireAccount().getId());
        return ResponseEntity.noContent().build();
    }

    @Override
    public ResponseEntity<List<ApiOpenPlace>> listOpenPlaces() {
        UserAccount account = currentUser.requireAccount();
        Map<UUID, String> labels = cards.allCards().stream()
                .collect(Collectors.toMap(BookingCard::getId, BookingCard::getLabel));
        return ResponseEntity.ok(partnerSearch.openPlaces(account.getId(), account.getPerson().getId(),
                        account.getRoles()).stream()
                .map(place -> new ApiOpenPlace(place.invitationId(), place.courtIds(),
                        WireTypes.toOffsetDateTime(place.slot().start()), WireTypes.toOffsetDateTime(place.slot().end()),
                        labels.getOrDefault(place.cardId(), "?")))
                .toList());
    }

    @Override
    public ResponseEntity<Void> acceptPartnerInvitation(UUID invitationId) {
        UserAccount account = currentUser.requireAccount();
        partnerSearch.accept(invitationId, account.getId(), account.getPerson().getId(), account.getRoles());
        return ResponseEntity.noContent().build();
    }
}
