package org.courtside.booking.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.booking.Booking;
import org.courtside.booking.BookingRepository;
import org.courtside.booking.CourtAllocation;
import org.courtside.booking.PersonBookingHistory;
import org.courtside.booking.series.BookingSeries;
import org.courtside.booking.series.BookingSeriesRepository;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class BookingHistoryService implements PersonBookingHistory {

    private final BookingRepository bookings;
    private final BookingSeriesRepository series;
    private final JdbcClient jdbc;

    @Override
    public List<Waiting> waitlistOf(UUID accountId) {
        requireIdentifier(accountId, "account");
        return jdbc.sql("""
                        SELECT id, court_id, starts_at, ends_at, state, joined_at, offer_expires_at, note
                        FROM waitlist_entry WHERE account_id = :accountId ORDER BY joined_seq
                        """)
                .param("accountId", accountId)
                .query((row, number) -> new Waiting(row.getObject("id", UUID.class),
                        row.getObject("court_id", UUID.class), instant(row.getTimestamp("starts_at")),
                        instant(row.getTimestamp("ends_at")), row.getString("state"),
                        instant(row.getTimestamp("joined_at")), instant(row.getTimestamp("offer_expires_at")),
                        row.getString("note")))
                .list();
    }

    @Override
    public List<NamedInWaitlist> namedInWaitlists(UUID personId) {
        requireIdentifier(personId, "person");
        return jdbc.sql("""
                        SELECT DISTINCT w.id, w.court_id, w.starts_at, w.ends_at, w.joined_seq
                        FROM waitlist_entry w JOIN waitlist_participant p ON p.entry_id = w.id
                        WHERE p.person_id = :personId
                          AND w.account_id NOT IN (SELECT id FROM user_account WHERE person_id = :personId)
                        ORDER BY w.joined_seq
                        """)
                .param("personId", personId)
                .query((row, number) -> new NamedInWaitlist(row.getObject("id", UUID.class),
                        row.getObject("court_id", UUID.class), instant(row.getTimestamp("starts_at")),
                        instant(row.getTimestamp("ends_at"))))
                .list();
    }

    private static Instant instant(Timestamp timestamp) {
        return timestamp == null ? null : timestamp.toInstant();
    }

    @Override
    public List<Made> madeBy(UUID accountId) {
        requireIdentifier(accountId, "account");
        return bookings.findByBookedByOrderByCreatedAtAscIdAsc(accountId).stream()
                .map(booking -> new Made(booking.getId(), booking.getCreatedAt(), booking.getStatus(),
                        booking.getCancelledAt(), booking.getCancellationReason(), booking.getNote(),
                        reservationsOf(booking)))
                .toList();
    }

    @Override
    public List<Recorded> recordedIn(UUID personId) {
        requireIdentifier(personId, "person");
        return bookings.findNamingParticipant(personId).stream()
                .map(booking -> new Recorded(booking.getId(), booking.getStatus(),
                        reservationsOf(booking)))
                .toList();
    }

    @Override
    public List<Series> seriesCreatedBy(UUID accountId) {
        requireIdentifier(accountId, "account");
        return series.findByCreatedByOrderByCreatedAtAscIdAsc(accountId).stream()
                .map(BookingHistoryService::toSeries)
                .toList();
    }

    private static Series toSeries(BookingSeries recurrence) {
        return new Series(recurrence.getId(), recurrence.getCreatedAt(),
                recurrence.getRule().startsOn(), recurrence.getRule().startTime(),
                recurrence.getRule().durationMinutes(), recurrence.getRule().intervalWeeks(),
                recurrence.getRule().weekdays(), recurrence.getRule().endsOn(),
                recurrence.getRule().occurrenceCount(), recurrence.getNote());
    }

    private static List<Reservation> reservationsOf(Booking booking) {
        return booking.getAllocations().stream()
                .sorted(Comparator.comparing(CourtAllocation::getStartsAt)
                        .thenComparing(CourtAllocation::getId))
                .map(allocation -> new Reservation(allocation.getCourtId(),
                        allocation.getStartsAt(), allocation.getEndsAt()))
                .toList();
    }

    // Without the guard a missing identifier matches every booking nobody is attributed with,
    // which is the club's whole unattended history rather than one person's part in it.
    private static void requireIdentifier(UUID identifier, String what) {
        if (identifier == null) {
            throw new IllegalStateException("A booking history needs a " + what + " id");
        }
    }
}
