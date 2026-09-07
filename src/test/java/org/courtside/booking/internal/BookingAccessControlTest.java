package org.courtside.booking.internal;

import org.courtside.booking.Booking;
import org.courtside.card.BookingCard;
import org.courtside.card.CardService;
import org.courtside.identity.Role;
import org.courtside.shared.SecurityEventLog;
import org.junit.jupiter.api.Test;

import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class BookingAccessControlTest {

    @Test
    void givenNoManagementRight_whenAccessIsHidden_thenTheAuthorizationRefusalIsStillRecorded() {
        Booking booking = mock(Booking.class);
        BookingCard card = mock(BookingCard.class);
        CardService cards = mock(CardService.class);
        SecurityEventLog securityEvents = mock(SecurityEventLog.class);
        UUID actor = UUID.randomUUID();
        UUID cardId = UUID.randomUUID();
        when(booking.getCardId()).thenReturn(cardId);
        when(cards.requireCard(cardId)).thenReturn(card);
        when(card.permitsManagement(Set.of())).thenReturn(false);

        BookingAccessControl access = new BookingAccessControl(cards, securityEvents);

        assertThatThrownBy(() -> access.requireRoleManagementAccess(booking, actor, Set.of(Role.MEMBER)))
                .isInstanceOf(BookingNotFoundException.class);
        verify(securityEvents).authorizationDenied(actor);
    }
}
