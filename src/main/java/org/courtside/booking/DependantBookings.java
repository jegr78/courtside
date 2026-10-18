package org.courtside.booking;

import lombok.RequiredArgsConstructor;
import org.courtside.booking.internal.BookingNotFoundException;
import org.courtside.member.GuardianDelegation;
import org.courtside.member.GuardianGrant;
import org.courtside.shared.SecurityEventLog;
import org.courtside.shared.TimeSlot;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.UUID;

/** A guardian's bookings for a dependant: held by the dependant's account and measured against the dependant. */
@Service
@RequiredArgsConstructor
public class DependantBookings {

    private final GuardianDelegation delegation;
    private final BookingService bookings;
    private final BookingRepository repository;
    private final SecurityEventLog securityEvents;

    public PersonalBookingPage bookingsOf(UUID dependantPersonId, PersonalBookingView view, UUID cursor, int limit) {
        GuardianDelegation.Delegation granted = delegation.require(dependantPersonId, GuardianGrant.VIEW_BOOKINGS);
        return bookings.personalBookings(granted.dependant().getId(), view, cursor, limit);
    }

    public UUID bookFor(UUID dependantPersonId, List<UUID> courtIds, UUID cardId, TimeSlot slot, String note,
                        List<ParticipantSpec> participants, String idempotencyKey) {
        GuardianDelegation.Delegation granted = delegation.requireBookable(dependantPersonId, GuardianGrant.BOOK);
        return bookings.create(new CreateBookingCommand(courtIds, cardId, slot, granted.dependant().getId(),
                dependantPersonId, granted.dependantRoles(), note, participants, null,
                granted.guardian().getId()), idempotencyKey);
    }

    // Cancelled in the holder's name, so the holder's deadline applies; the change log records the guardian.
    public void cancelFor(UUID dependantPersonId, UUID bookingId) {
        GuardianDelegation.Delegation granted = delegation.require(dependantPersonId, GuardianGrant.CANCEL_BOOKINGS);
        UUID holder = granted.dependant().getId();
        boolean held = bookingId != null && repository.findById(bookingId)
                .map(booking -> holder.equals(booking.getBookedBy()))
                .orElse(false);
        if (held) {
            bookings.cancel(bookingId, holder, granted.dependantRoles(), null);
            return;
        }
        securityEvents.authorizationDenied(granted.guardian().getId());
        throw new BookingNotFoundException("Person %s holds no booking %s".formatted(dependantPersonId, bookingId));
    }
}
