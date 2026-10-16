package org.courtside.booking.attendance;

import lombok.RequiredArgsConstructor;
import org.courtside.booking.attendance.AttendanceRows.BookingState;
import org.courtside.booking.attendance.AttendanceRows.NoShow;
import org.courtside.booking.internal.BookingNotFoundException;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Transactional
public class AttendanceService {

    static final Duration CHECK_IN_OPENS = Duration.ofMinutes(15);

    private final AttendanceRows rows;
    private final UserAccountRepository accounts;
    private final ApplicationEventPublisher events;
    private final Clock clock;

    @Transactional(readOnly = true)
    public AttendancePolicy policy() {
        return rows.policy();
    }

    public AttendancePolicy changePolicy(AttendancePolicy changed) {
        AttendancePolicy current = rows.lockPolicy();
        List<String> fields = new ArrayList<>();
        if (current.enabled() != changed.enabled()) {
            fields.add("enabled");
        }
        if (!Objects.equals(current.releaseAfterMinutes(), changed.releaseAfterMinutes())) {
            fields.add("releaseAfterMinutes");
        }
        if (!fields.isEmpty()) {
            rows.writePolicy(changed);
            events.publishEvent(new AttendanceEvent.PolicyChanged(AttendanceRows.POLICY_ID, changed.enabled(),
                    changed.releaseAfterMinutes(), fields));
        }
        return changed;
    }

    @Transactional(readOnly = true)
    public Optional<AttendanceOutcome> outcomeOf(UUID bookingId) {
        return rows.outcomeOf(bookingId);
    }

    /** The check-in windows of these bookings, empty while the club records no attendance. */
    @Transactional(readOnly = true)
    public Map<UUID, CheckIn> checkInsOf(Collection<TimedBooking> bookings) {
        if (bookings.isEmpty() || !rows.policy().enabled()) {
            return Map.of();
        }
        Map<UUID, AttendanceOutcome> outcomes = rows.outcomesOf(bookings.stream().map(TimedBooking::id).toList());
        return bookings.stream().collect(Collectors.toMap(TimedBooking::id, booking -> new CheckIn(
                booking.startsAt().minus(CHECK_IN_OPENS), booking.endsAt(),
                outcomes.get(booking.id()) == AttendanceOutcome.ATTENDED)));
    }

    @Transactional(readOnly = true)
    public Set<UUID> releasedAmong(Collection<UUID> bookingIds) {
        return bookingIds.isEmpty() ? Set.of() : rows.releasedAmong(bookingIds);
    }

    public void record(UUID bookingId, AttendanceOutcome outcome, UUID recordedBy) {
        requireTracked();
        BookingState booking = lockedBooking(bookingId);
        if (booking.bookedBy() == null || !hasBegun(booking)) {
            throw new AttendanceNotRecordableException();
        }
        if (rows.outcomeOf(bookingId).filter(outcome::equals).isPresent()) {
            return;
        }
        rows.write(bookingId, outcome, recordedBy, clock.instant());
        events.publishEvent(new AttendanceEvent.Recorded(bookingId, outcome));
    }

    public void clear(UUID bookingId) {
        lockedBooking(bookingId);
        if (rows.clear(bookingId)) {
            events.publishEvent(new AttendanceEvent.Cleared(bookingId));
        }
    }

    public void checkIn(UUID bookingId, UUID accountId) {
        requireTracked();
        BookingState booking = lockedBooking(bookingId);
        if (!accountId.equals(booking.bookedBy())) {
            throw new BookingNotFoundException("No booking with id " + bookingId);
        }
        Optional<AttendanceOutcome> recorded = rows.outcomeOf(bookingId);
        if (recorded.filter(AttendanceOutcome.ATTENDED::equals).isPresent()) {
            return;
        }
        if (!booking.confirmed() || recorded.isPresent() || !checkInOpen(booking.startsAt(), booking.endsAt())) {
            throw new CheckInClosedException();
        }
        rows.write(bookingId, AttendanceOutcome.ATTENDED, accountId, clock.instant());
        events.publishEvent(new AttendanceEvent.Recorded(bookingId, AttendanceOutcome.ATTENDED));
    }

    @Transactional(readOnly = true)
    public List<NoShow> noShowsOf(UUID personId) {
        return accounts.findByPersonId(personId)
                .map(account -> rows.countingNoShowsOf(account.getId()))
                .orElse(List.of());
    }

    public int liftNoShows(UUID personId, UUID liftedBy) {
        Optional<UserAccount> account = accounts.findByPersonId(personId);
        if (account.isEmpty()) {
            return 0;
        }
        int lifted = rows.liftNoShowsOf(account.get().getId(), liftedBy, clock.instant());
        if (lifted > 0) {
            events.publishEvent(new AttendanceEvent.NoShowsLifted(personId, account.get().getId(), lifted));
        }
        return lifted;
    }

    public record TimedBooking(UUID id, Instant startsAt, Instant endsAt) {
    }

    public record CheckIn(Instant opensAt, Instant closesAt, boolean checkedIn) {
    }

    private boolean checkInOpen(Instant startsAt, Instant endsAt) {
        Instant now = clock.instant();
        return !now.isBefore(startsAt.minus(CHECK_IN_OPENS)) && now.isBefore(endsAt);
    }

    // A booking cancelled before its start had nobody to wait for; one freed after it did.
    private boolean hasBegun(BookingState booking) {
        return !booking.startsAt().isAfter(clock.instant())
                && (booking.cancelledAt() == null || !booking.cancelledAt().isBefore(booking.startsAt()));
    }

    private void requireTracked() {
        if (!rows.policy().enabled()) {
            throw new AttendanceNotTrackedException();
        }
    }

    private BookingState lockedBooking(UUID bookingId) {
        return rows.lockBooking(bookingId)
                .orElseThrow(() -> new BookingNotFoundException("No booking with id " + bookingId));
    }
}
