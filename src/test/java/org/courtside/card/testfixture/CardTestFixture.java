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

    public UUID createUnlimitedParticipantCard(String label) {
        return cards.createParticipantCard(label, null).getId();
    }
}
