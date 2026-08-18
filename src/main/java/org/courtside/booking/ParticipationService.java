package org.courtside.booking;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.courtside.shared.CursorPage;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Slf4j
@Service
@RequiredArgsConstructor
public class ParticipationService {

    private static final int MAX_PAGE_SIZE = 100;

    private final BookingRepository bookings;

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public ParticipationPage participations(UUID personId, UUID accountId, UUID cursor, int limit) {
        requireAccount(accountId);
        requirePageLimit(limit);
        if (personId == null) {
            return new ParticipationPage(List.of(), null);
        }
        List<UUID> ids = bookings.findParticipationIds(
                personId, accountId, cursor, PageRequest.of(0, Math.addExact(limit, 1)));
        CursorPage.Result<Booking> page =
                CursorPage.of(ids, limit, bookings::findAllByIdIn, Booking::getId);
        return new ParticipationPage(page.items(), page.nextCursor());
    }

    @Transactional
    public void withdraw(UUID bookingId, UUID personId, UUID accountId) {
        requireAccount(accountId);
        if (bookingId == null || personId == null) {
            throw new ParticipationNotFoundException(
                    "An account with no person of its own is recorded in no booking");
        }
        Booking booking = bookings.findWithParticipantsById(bookingId)
                .filter(found -> !accountId.equals(found.getBookedBy()))
                .orElseThrow(() -> notRecorded(bookingId));
        if (!booking.withdrawParticipant(personId)) {
            throw notRecorded(bookingId);
        }
        bookings.saveAndFlush(booking);
        log.info("Member {} withdrew from booking {}", personId, bookingId);
    }

    private static ParticipationNotFoundException notRecorded(UUID bookingId) {
        return new ParticipationNotFoundException("Booking " + bookingId
                + " does not record this member as a participant");
    }

    private static void requireAccount(UUID accountId) {
        if (accountId == null) {
            throw new IllegalStateException("A participation belongs to a signed-in account");
        }
    }

    private static void requirePageLimit(int limit) {
        if (limit < 1 || limit > MAX_PAGE_SIZE) {
            throw new IllegalStateException(
                    "Participation page size must be between 1 and " + MAX_PAGE_SIZE);
        }
    }
}
