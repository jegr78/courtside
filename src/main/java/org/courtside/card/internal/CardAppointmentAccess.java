package org.courtside.card.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.card.BookingCard;
import org.courtside.card.CardService;
import org.courtside.identity.AppointmentAccess;
import org.courtside.identity.Role;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Set;

@Service
@RequiredArgsConstructor
class CardAppointmentAccess implements AppointmentAccess {

    private final CardService cards;

    @Override
    public Reach reachOf(Set<Role> roles) {
        if (roles.contains(Role.ADMIN)) {
            return new Reach(true, true);
        }
        List<BookingCard> active = cards.activeCards();
        return new Reach(
                active.stream().anyMatch(card -> card.permitsManagement(BookingCard.managementRoles(roles))),
                active.stream().anyMatch(card -> card.permits(roles) && !card.tracksPlayers()));
    }
}
