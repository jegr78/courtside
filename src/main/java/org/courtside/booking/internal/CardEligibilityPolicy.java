package org.courtside.booking.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.card.BookingCard;
import org.courtside.card.CardService;
import org.courtside.config.ExternalBookings;
import org.courtside.identity.Role;
import org.courtside.member.MemberService;
import org.courtside.shared.SecurityEventLog;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Component
@RequiredArgsConstructor
public class CardEligibilityPolicy {

    private final CardService cards;
    private final SecurityEventLog securityEvents;
    private final MemberService members;
    private final ExternalBookings externalBookings;

    public BookingCard requireActive(UUID cardId) {
        BookingCard card = cards.findCard(cardId)
                .orElseThrow(() -> new CardNotBookableException(
                        "card.unknown", Map.of("field", "cardId")));
        if (!card.isActive()) {
            throw new CardNotBookableException("card.inactive", Map.of("field", "cardId"));
        }
        return card;
    }

    // The same verdict as requireEligible without recording a denial, for checks nobody asked to make.
    public boolean admits(UUID cardId, UUID accountId, Set<Role> callerRoles) {
        return cards.findCard(cardId)
                .filter(BookingCard::isActive)
                .filter(card -> permits(card, accountId, callerRoles))
                .isPresent();
    }

    public BookingCard requireEligible(UUID cardId, UUID accountId, Set<Role> callerRoles) {
        BookingCard card = requireActive(cardId);
        if (!permits(card, accountId, callerRoles)) {
            securityEvents.authorizationDeniedForCurrentAccount();
            throw new CardRoleRequiredException(
                    "Card %s requires one of roles %s".formatted(card.getId(), card.getAllowedRoles()));
        }
        return card;
    }

    private boolean permits(BookingCard card, UUID accountId, Set<Role> callerRoles) {
        return callerRoles.contains(Role.ADMIN)
                || card.permits(callerRoles, card.requiresMembership() && members.isCurrentMember(accountId),
                externalBookings.admitted());
    }
}
