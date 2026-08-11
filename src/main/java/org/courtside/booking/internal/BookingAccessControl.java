package org.courtside.booking.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.booking.Booking;
import org.courtside.card.BookingCard;
import org.courtside.card.CardService;
import org.courtside.identity.Role;
import org.springframework.stereotype.Component;

import java.util.Set;
import java.util.UUID;

@Component
@RequiredArgsConstructor
public class BookingAccessControl {

    private final CardService cards;

    public void requireManagementAccess(Booking booking, UUID actor, Set<Role> actorRoles) {
        if (actor == null || actorRoles == null) {
            throw new IllegalStateException("Booking management requires an authenticated actor");
        }
        if (actorRoles.contains(Role.ADMIN) || actor.equals(booking.getBookedBy())) {
            return;
        }
        BookingCard card = cards.requireCard(booking.getCardId());
        if (!card.getAllowedRoles().isEmpty() && card.permits(actorRoles)) {
            return;
        }
        throw new BookingNotOwnedException(
                "Account %s may not manage booking %s".formatted(actor, booking.getId()));
    }
}
