package org.courtside.booking;

import org.courtside.booking.internal.BookingNotFoundException;
import org.courtside.booking.internal.DependantBookingNotHeldException;
import org.courtside.identity.UserAccount;
import org.courtside.member.GuardianDelegation;
import org.courtside.member.GuardianGrant;
import org.junit.jupiter.api.Test;

import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class DependantBookingsTest {

    @Test
    void givenABookingTheDependantDoesNotHold_whenTheGuardianCancelsIt_thenItIsRefusedAsAnUnknownBooking() {
        // given
        GuardianDelegation delegation = mock(GuardianDelegation.class);
        BookingService bookings = mock(BookingService.class);
        BookingRepository repository = mock(BookingRepository.class);
        UserAccount guardian = mock(UserAccount.class);
        UserAccount dependant = mock(UserAccount.class);
        Booking booking = mock(Booking.class);
        UUID dependantPersonId = UUID.randomUUID();
        UUID bookingId = UUID.randomUUID();
        when(dependant.getId()).thenReturn(UUID.randomUUID());
        when(delegation.require(dependantPersonId, GuardianGrant.CANCEL_BOOKINGS))
                .thenReturn(new GuardianDelegation.Delegation(guardian, dependant));
        when(booking.getBookedBy()).thenReturn(UUID.randomUUID());
        when(repository.findById(bookingId)).thenReturn(Optional.of(booking));
        DependantBookings dependantBookings = new DependantBookings(delegation, bookings, repository);

        // when / then
        assertThatThrownBy(() -> dependantBookings.cancelFor(dependantPersonId, bookingId))
                .isInstanceOfSatisfying(DependantBookingNotHeldException.class, refusal -> {
                    assertThat(refusal.problemType()).as("answered like an unknown booking")
                            .isEqualTo(BookingNotFoundException.PROBLEM_TYPE);
                    assertThat(refusal.refusesAuthorization()).as("the answer records the refusal").isTrue();
                });
        verify(bookings, never()).cancel(any(), any(), any(), any());
    }
}
