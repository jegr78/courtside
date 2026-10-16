package org.courtside.card.testfixture;

import lombok.RequiredArgsConstructor;
import org.courtside.card.BookingCard;
import org.courtside.card.CardService;
import org.courtside.identity.Role;

import java.util.Set;
import java.util.UUID;

@RequiredArgsConstructor
public final class CardTestFixture {

    private final CardService cards;

    public static BookingCard bookingCardAllowing(Role... roles) {
        return new BookingCard("Training", "#34584A", Set.of(roles), Set.of(),
                new short[]{}, false, false, false);
    }

    public UUID createBookingCard(String label, Set<Role> allowedRoles, Set<Role> managingRoles,
                                  short... allowedPlayerCounts) {
        return cards.createCard(label, "#34584A", allowedRoles, managingRoles, allowedPlayerCounts,
                false, false, false).getId();
    }

    public UUID createCardCountingAgainstLimits(String label, Set<Role> allowedRoles) {
        return cards.createCard(label, "#34584A", allowedRoles, Set.of(), new short[]{}, true, false, false).getId();
    }

    public UUID createDoublesCardForGuests(String label, Set<Role> managingRoles) {
        return cards.createCard(label, "#34584A", Set.of(), managingRoles, new short[]{2},
                false, true, false).getId();
    }

    public void deactivateBookingCard(UUID cardId) {
        cards.setCardActive(cardId, false);
    }

    public UUID createUnlimitedParticipantCard(String label) {
        return cards.createParticipantCard(label, null).getId();
    }
}
