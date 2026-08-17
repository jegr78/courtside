package org.courtside.booking.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.booking.Booking;
import org.courtside.booking.BookingParticipant;
import org.courtside.booking.BookingRepository;
import org.courtside.card.BookingCard;
import org.courtside.card.CardService;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.Role;
import org.courtside.shared.CursorPage;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Set;
import java.util.UUID;

@Component
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class ManagedAppointmentQuery {

    private static final int MAX_PAGE_SIZE = 100;

    private final BookingRepository bookings;
    private final BookingAccessControl accessControl;
    private final CardService cards;
    private final PersonRepository persons;

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public Page list(Set<Role> roles, UUID cursor, int limit) {
        validatePageLimit(limit);
        Set<Role> managementRoles = accessControl.managementRoles(roles);
        if (!roles.contains(Role.ADMIN) && managementRoles.isEmpty()) {
            return new Page(List.of(), null);
        }
        List<UUID> ids = bookings.findManagedBookingIds(
                managementRoles, roles.contains(Role.ADMIN), cursor,
                PageRequest.of(0, Math.addExact(limit, 1)));
        CursorPage.Result<Booking> page = CursorPage.of(ids, limit, bookings::findAllByIdIn, Booking::getId);
        return new Page(page.items(), page.nextCursor());
    }

    private static void validatePageLimit(int limit) {
        if (limit < 1 || limit > MAX_PAGE_SIZE) {
            throw new IllegalStateException(
                    "Managed appointment page size must be between 1 and " + MAX_PAGE_SIZE);
        }
    }

    public Detail get(UUID bookingId, UUID actor, Set<Role> roles) {
        Booking booking = bookings.findWithAllocationsById(bookingId)
                .orElseThrow(() -> new BookingNotFoundException("No booking with id " + bookingId));
        accessControl.requireRoleManagementAccess(booking, actor, roles);
        Booking participants = bookings.findWithParticipantsById(bookingId).orElseThrow();
        BookingCard card = cards.requireCard(booking.getCardId());
        return new Detail(booking, card, participants.getParticipants().stream()
                .map(this::resolveParticipant)
                .toList());
    }

    private Participant resolveParticipant(BookingParticipant participant) {
        String displayName = switch (participant.getKind()) {
            case MEMBER -> persons.findById(participant.getPersonId())
                    .orElseThrow(() -> new IllegalStateException("A booking references an unknown person"))
                    .getDisplayName();
            case GUEST -> participant.getGuestName();
            case CARD -> cards.requireParticipantCard(participant.getCardId()).getLabel();
        };
        return new Participant(participant.getKind().name(), displayName);
    }

    public record Page(List<Booking> bookings, UUID nextCursor) {

        public Page {
            bookings = List.copyOf(bookings);
        }
    }

    public record Detail(Booking booking, BookingCard card, List<Participant> participants) {

        public Detail {
            participants = List.copyOf(participants);
        }
    }

    public record Participant(String kind, String displayName) {
    }
}
