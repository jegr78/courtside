package org.courtside.booking.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.booking.Booking;
import org.courtside.card.BookingCard;
import org.courtside.card.CardService;
import org.courtside.identity.Role;
import org.springframework.stereotype.Component;

import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

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
        requireRoleManagementAccess(booking, actor, actorRoles);
    }

    public void requireRoleManagementAccess(Booking booking, UUID actor, Set<Role> actorRoles) {
        if (actor == null || actorRoles == null) {
            throw new IllegalStateException("Booking management requires an authenticated actor");
        }
        if (actorRoles.contains(Role.ADMIN)) {
            return;
        }
        BookingCard card = cards.requireCard(booking.getCardId());
        if (!card.getAllowedRoles().isEmpty() && card.permits(managementRoles(actorRoles))) {
            return;
        }
        throw new BookingNotOwnedException(
                "Account %s may not manage booking %s".formatted(actor, booking.getId()));
    }

    Set<Role> managementRoles(Set<Role> roles) {
        return roles.stream()
                .filter(role -> role != Role.MEMBER)
                .collect(Collectors.toUnmodifiableSet());
    }
}
