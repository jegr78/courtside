package org.courtside.card.testfixture;

import org.courtside.card.BookingCard;
import org.courtside.identity.Role;

import java.util.Set;

public final class CardTestFixture {

    private CardTestFixture() {
    }

    public static BookingCard bookingCardAllowing(Role... roles) {
        return new BookingCard("Training", "#34584A", Set.of(roles), Set.of(),
                new short[]{}, false, false, false);
    }
}
