package org.courtside.booking.waitlist;

import lombok.RequiredArgsConstructor;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.internal.BookingDrafts;
import org.courtside.config.BookingGridCoordination;
import org.courtside.identity.Role;
import org.courtside.shared.SqlConstraintViolation;
import org.courtside.shared.TimeSlot;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class WaitlistService {

    private static final String ONE_OPEN_ENTRY = "waitlist_entry_one_open_per_account";
    static final int MAX_ENTRIES = 20;

    private final WaitlistRows rows;
    private final WaitlistQueue queue;
    private final BookingDrafts drafts;
    private final BookingGridCoordination grid;
    private final Clock clock;

    @Transactional
    public UUID join(JoinWaitlistCommand command) {
        grid.lock();
        drafts.requireBookable(command.asBooking());
        if (rows.confirmedOverlap(command.courtId(), command.slot(), command.accountId())
                || rows.offerOverlap(command.courtId(), command.slot(), command.accountId())) {
            throw WaitlistSlotNotTakenException.own();
        }
        if (!rows.confirmedOverlap(command.courtId(), command.slot(), null)
                && !rows.offerOverlap(command.courtId(), command.slot(), null)) {
            throw WaitlistSlotNotTakenException.free();
        }
        if (rows.countNotEnded(command.accountId(), clock.instant()) >= MAX_ENTRIES) {
            throw new WaitlistLimitReachedException(MAX_ENTRIES);
        }
        UUID id = UUID.randomUUID();
        try {
            rows.insert(id, command, clock.instant());
        } catch (DataIntegrityViolationException failure) {
            if (SqlConstraintViolation.matches(failure, SqlConstraintViolation.EXCLUSION_VIOLATION, ONE_OPEN_ENTRY)) {
                throw new WaitlistEntryExistsException(failure);
            }
            throw failure;
        }
        return id;
    }

    @Transactional
    public void leave(UUID entryId, UUID accountId) {
        grid.lock();
        WaitlistEntry entry = rows.lockOwn(entryId, accountId).orElseThrow(WaitlistEntryNotFoundException::new);
        if (!entry.state().isOpen()) {
            return;
        }
        rows.close(entry.id(), WaitlistState.LEFT, clock.instant());
        if (entry.state() == WaitlistState.OFFERED) {
            queue.offerFreeQueues(List.of(entry.courtId()), entry.slot());
        }
    }

    // Accepting twice answers with the booking the first acceptance made while that booking stands.
    @Transactional
    public UUID accept(UUID entryId, UUID accountId, UUID personId, Set<Role> roles) {
        grid.lock();
        WaitlistEntry entry = rows.lockOwn(entryId, accountId).orElseThrow(WaitlistEntryNotFoundException::new);
        if (entry.state() == WaitlistState.BOOKED && entry.bookingId() != null
                && rows.confirmedBooking(entry.bookingId())) {
            return entry.bookingId();
        }
        if (entry.state() != WaitlistState.OFFERED || !entry.offerExpiresAt().isAfter(clock.instant())) {
            throw new WaitlistNoOfferException();
        }
        return drafts.write(new CreateBookingCommand(List.of(entry.courtId()), entry.cardId(), entry.slot(),
                accountId, personId, roles, entry.note(), rows.participants(entry.id()), null));
    }

    // An offer past its deadline reads as expired before the sweep has written it so.
    @Transactional(readOnly = true)
    public List<WaitlistEntry> ownEntries(UUID accountId) {
        Instant now = clock.instant();
        return rows.ownNotEnded(accountId, now).stream()
                .map(entry -> entry.state() == WaitlistState.OFFERED && !entry.offerExpiresAt().isAfter(now)
                        ? new WaitlistEntry(entry.id(), entry.accountId(), entry.courtId(), entry.cardId(),
                                entry.slot(), entry.note(), WaitlistState.EXPIRED, entry.offerExpiresAt(),
                                entry.bookingId())
                        : entry)
                .toList();
    }

    @Transactional(readOnly = true)
    public List<Reservation> reservationsBetween(Instant from, Instant to, UUID viewerAccountId) {
        return rows.offeredBetween(from, to).stream()
                .map(entry -> {
                    boolean own = entry.accountId().equals(viewerAccountId);
                    return new Reservation(entry.courtId(), entry.slot(), own ? entry.id() : null);
                })
                .toList();
    }

    // Nobody but the holder learns whose reservation it is.
    public record Reservation(UUID courtId, TimeSlot slot, UUID ownEntryId) {
    }
}
