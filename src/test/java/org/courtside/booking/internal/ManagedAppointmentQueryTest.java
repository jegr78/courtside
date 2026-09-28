package org.courtside.booking.internal;

import org.courtside.booking.BookingRepository;
import org.courtside.card.CardService;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.Role;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.time.Clock;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

class ManagedAppointmentQueryTest {

    private final BookingRepository bookings = mock(BookingRepository.class);
    private final BookingAccessControl accessControl = mock(BookingAccessControl.class);
    private final CardService cards = mock(CardService.class);
    private final PersonRepository persons = mock(PersonRepository.class);
    private final Clock clock = mock(Clock.class);
    private final ManagedAppointmentQuery query =
            new ManagedAppointmentQuery(bookings, accessControl, cards, persons, clock);

    @ParameterizedTest
    @ValueSource(ints = {Integer.MIN_VALUE, 0, 21, Integer.MAX_VALUE})
    void givenAnInvalidPageLimit_whenListingManagedAppointments_thenItIsRejectedBeforeAccess(int limit) {
        // when / then
        assertThatThrownBy(() -> query.list(Set.of(Role.ADMIN), ManagedAppointmentQuery.View.UPCOMING,
                null, null, null, limit))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("Managed appointment page size must be between 1 and 20");
        verifyNoInteractions(bookings, accessControl, cards, persons, clock);
    }
}
