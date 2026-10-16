package org.courtside.booking.attendance;

import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

@Component
@RequiredArgsConstructor
public class AttendanceRows {

    static final UUID POLICY_ID = UUID.fromString("a77e0000-0000-0000-0000-000000000001");

    private final JdbcClient jdbc;

    public AttendancePolicy policy() {
        return jdbc.sql("SELECT enabled, release_after_minutes FROM attendance_policy WHERE id = :id")
                .param("id", POLICY_ID)
                .query((rs, row) -> new AttendancePolicy(rs.getBoolean("enabled"),
                        (Integer) rs.getObject("release_after_minutes")))
                .single();
    }

    AttendancePolicy lockPolicy() {
        jdbc.sql("SELECT id FROM attendance_policy WHERE id = :id FOR UPDATE").param("id", POLICY_ID)
                .query(UUID.class).single();
        return policy();
    }

    void writePolicy(AttendancePolicy policy) {
        jdbc.sql("UPDATE attendance_policy SET enabled = :enabled, release_after_minutes = :minutes WHERE id = :id")
                .param("enabled", policy.enabled())
                .param("minutes", policy.releaseAfterMinutes())
                .param("id", POLICY_ID)
                .update();
    }

    Optional<BookingState> lockBooking(UUID bookingId) {
        return jdbc.sql("""
                        SELECT b.status, b.booked_by, b.cancelled_at,
                               (SELECT min(a.starts_at) FROM court_allocation a WHERE a.booking_id = b.id) AS starts_at,
                               (SELECT max(a.ends_at) FROM court_allocation a WHERE a.booking_id = b.id) AS ends_at,
                               c.counts_against_limits
                        FROM booking b
                        JOIN booking_card c ON c.id = b.card_id
                        WHERE b.id = :id
                        FOR UPDATE OF b
                        """)
                .param("id", bookingId)
                .query((rs, row) -> new BookingState(bookingId, "CONFIRMED".equals(rs.getString("status")),
                        rs.getObject("booked_by", UUID.class), instant(rs.getTimestamp("cancelled_at")),
                        instant(rs.getTimestamp("starts_at")), instant(rs.getTimestamp("ends_at")),
                        rs.getBoolean("counts_against_limits")))
                .optional();
    }

    Optional<AttendanceOutcome> outcomeOf(UUID bookingId) {
        return jdbc.sql("SELECT outcome FROM booking_attendance WHERE booking_id = :id")
                .param("id", bookingId)
                .query((rs, row) -> AttendanceOutcome.valueOf(rs.getString("outcome")))
                .optional();
    }

    void write(UUID bookingId, AttendanceOutcome outcome, UUID recordedBy, Instant at) {
        jdbc.sql("""
                        INSERT INTO booking_attendance (booking_id, outcome, recorded_at, recorded_by)
                        VALUES (:id, :outcome, :at, :by)
                        ON CONFLICT (booking_id) DO UPDATE
                            SET outcome = EXCLUDED.outcome, recorded_at = EXCLUDED.recorded_at,
                                recorded_by = EXCLUDED.recorded_by, lifted_at = NULL, lifted_by = NULL
                        """)
                .param("id", bookingId)
                .param("outcome", outcome.name())
                .param("at", Timestamp.from(at))
                .param("by", recordedBy)
                .update();
    }

    Map<UUID, AttendanceOutcome> outcomesOf(Collection<UUID> bookingIds) {
        return jdbc.sql("SELECT booking_id, outcome FROM booking_attendance WHERE booking_id IN (:ids)")
                .param("ids", bookingIds)
                .query((rs, row) -> Map.entry(rs.getObject("booking_id", UUID.class),
                        AttendanceOutcome.valueOf(rs.getString("outcome"))))
                .list().stream()
                .collect(Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue));
    }

    Set<UUID> releasedAmong(Collection<UUID> bookingIds) {
        return Set.copyOf(jdbc.sql("SELECT booking_id FROM booking_release WHERE booking_id IN (:ids)")
                .param("ids", bookingIds)
                .query(UUID.class)
                .list());
    }

    boolean clear(UUID bookingId) {
        return jdbc.sql("DELETE FROM booking_attendance WHERE booking_id = :id").param("id", bookingId).update() > 0;
    }

    public long countNoShowsSince(UUID accountId, Instant since) {
        return jdbc.sql("""
                        SELECT count(*) FROM booking_attendance ba
                        JOIN booking b ON b.id = ba.booking_id
                        WHERE b.booked_by = :accountId AND ba.outcome = 'NO_SHOW' AND ba.lifted_at IS NULL
                          AND (SELECT min(a.starts_at) FROM court_allocation a WHERE a.booking_id = b.id) >= :since
                        """)
                .param("accountId", accountId)
                .param("since", Timestamp.from(since))
                .query(Long.class)
                .single();
    }

    List<NoShow> countingNoShowsOf(UUID accountId) {
        return jdbc.sql("""
                        SELECT b.id, min(a.starts_at) AS starts_at, max(a.ends_at) AS ends_at, ba.recorded_at
                        FROM booking_attendance ba
                        JOIN booking b ON b.id = ba.booking_id
                        JOIN court_allocation a ON a.booking_id = b.id
                        WHERE b.booked_by = :accountId AND ba.outcome = 'NO_SHOW' AND ba.lifted_at IS NULL
                        GROUP BY b.id, ba.recorded_at
                        ORDER BY min(a.starts_at) DESC, b.id
                        """)
                .param("accountId", accountId)
                .query((rs, row) -> new NoShow(rs.getObject("id", UUID.class), instant(rs.getTimestamp("starts_at")),
                        instant(rs.getTimestamp("ends_at"))))
                .list();
    }

    int liftNoShowsOf(UUID accountId, UUID liftedBy, Instant at) {
        return jdbc.sql("""
                        UPDATE booking_attendance ba SET lifted_at = :at, lifted_by = :by
                        FROM booking b
                        WHERE b.id = ba.booking_id AND b.booked_by = :accountId
                          AND ba.outcome = 'NO_SHOW' AND ba.lifted_at IS NULL
                        """)
                .param("at", Timestamp.from(at))
                .param("by", liftedBy)
                .param("accountId", accountId)
                .update();
    }

    List<UUID> dueForRelease(Instant startedBy, Instant now) {
        return jdbc.sql("""
                        SELECT b.id
                        FROM booking b
                        JOIN booking_card c ON c.id = b.card_id AND c.counts_against_limits
                        JOIN court_allocation a ON a.booking_id = b.id
                        WHERE b.status = 'CONFIRMED' AND b.booked_by IS NOT NULL
                          AND a.starts_at > :earliest AND a.starts_at <= :startedBy AND a.ends_at > :now
                          AND NOT EXISTS (SELECT 1 FROM booking_attendance ba WHERE ba.booking_id = b.id)
                        GROUP BY b.id
                        """)
                .param("earliest", Timestamp.from(now.minus(Duration.ofDays(1))))
                .param("startedBy", Timestamp.from(startedBy))
                .param("now", Timestamp.from(now))
                .query(UUID.class)
                .list();
    }

    void markReleased(UUID bookingId, Instant at) {
        jdbc.sql("INSERT INTO booking_release (booking_id, released_at) VALUES (:id, :at)")
                .param("id", bookingId)
                .param("at", Timestamp.from(at))
                .update();
    }

    private static Instant instant(Timestamp timestamp) {
        return timestamp == null ? null : timestamp.toInstant();
    }

    record BookingState(UUID id, boolean confirmed, UUID bookedBy, Instant cancelledAt, Instant startsAt,
                        Instant endsAt, boolean countsAgainstLimits) {
    }

    public record NoShow(UUID bookingId, Instant startsAt, Instant endsAt) {
    }
}
