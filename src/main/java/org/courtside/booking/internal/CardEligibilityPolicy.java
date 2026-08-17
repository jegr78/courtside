package org.courtside.booking.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.card.BookingCard;
import org.courtside.card.CardService;
import org.courtside.identity.Role;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Component
@RequiredArgsConstructor
public class CardEligibilityPolicy {

    private final CardService cards;

    public BookingCard requireActive(UUID cardId) {
        BookingCard card = cards.findCard(cardId)
                .orElseThrow(() -> new CardNotBookableException(
                        "card.unknown", Map.of("field", "cardId")));
        if (!card.isActive()) {
            throw new CardNotBookableException("card.inactive", Map.of("field", "cardId"));
        }
        return card;
    }

    public BookingCard requireEligible(UUID cardId, Set<Role> callerRoles) {
        BookingCard card = requireActive(cardId);
        if (!callerRoles.contains(Role.ADMIN) && !card.permits(callerRoles)) {
            throw new CardRoleRequiredException(
                    "Card %s requires one of roles %s".formatted(card.getId(), card.getAllowedRoles()));
        }
        return card;
    }
}
