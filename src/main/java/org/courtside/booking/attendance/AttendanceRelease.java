package org.courtside.booking.attendance;

import lombok.RequiredArgsConstructor;
import org.courtside.booking.internal.UnattendedRelease;
import org.courtside.config.BookingGridCoordination;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Component
public class AttendanceRelease {

    private final AttendanceRows rows;
    private final UnattendedRelease release;
    private final BookingGridCoordination grid;
    private final ApplicationEventPublisher events;
    private final Clock clock;
    private final TransactionTemplate transactions;

    AttendanceRelease(AttendanceRows rows, UnattendedRelease release, BookingGridCoordination grid,
                      ApplicationEventPublisher events, Clock clock, PlatformTransactionManager transactionManager) {
        this.rows = rows;
        this.release = release;
        this.grid = grid;
        this.events = events;
        this.clock = clock;
        this.transactions = new TransactionTemplate(transactionManager);
    }

    /** Frees every member booking nobody checked in for within the club's release time; returns how many. */
    public int releaseDue() {
        AttendancePolicy policy = rows.policy();
        if (!policy.enabled() || policy.releaseAfter().isEmpty()) {
            return 0;
        }
        Duration after = policy.releaseAfter().get();
        Instant now = clock.instant();
        List<UUID> due = rows.dueForRelease(now.minus(after), now);
        int released = 0;
        for (UUID bookingId : due) {
            if (Boolean.TRUE.equals(transactions.execute(status -> releaseIfStillDue(bookingId, after)))) {
                released++;
            }
        }
        return released;
    }

    // The grid lock comes first, as for every other cancellation, and the booking row is read again under it.
    private boolean releaseIfStillDue(UUID bookingId, Duration after) {
        grid.lock();
        AttendancePolicy policy = rows.policy();
        Instant now = clock.instant();
        boolean due = policy.enabled() && policy.releaseAfter().isPresent()
                && rows.lockBooking(bookingId)
                        .filter(booking -> booking.confirmed() && booking.bookedBy() != null
                                && booking.countsAgainstLimits()
                                && !booking.startsAt().plus(after).isAfter(now) && booking.endsAt().isAfter(now))
                        .isPresent()
                && rows.outcomeOf(bookingId).isEmpty();
        if (!due || !release.release(bookingId)) {
            return false;
        }
        rows.markReleased(bookingId, now);
        events.publishEvent(new AttendanceEvent.Released(bookingId));
        return true;
    }
}
