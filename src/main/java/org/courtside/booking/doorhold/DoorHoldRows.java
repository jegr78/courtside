package org.courtside.booking.doorhold;

import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Component
@RequiredArgsConstructor
class DoorHoldRows {

    // A booking lies within one day and the access lead is at most four hours, so no running hold is older.
    private static final Duration RUNNING_HOLD_REACH = Duration.ofDays(2);

    private final JdbcClient jdbc;

    /** The newest unended hold of each booking that began inside that booking's window. */
    List<Hold> unendedSince(Collection<Window> windows) {
        if (windows.isEmpty()) {
            return List.of();
        }
        List<Window> ordered = List.copyOf(windows);
        return jdbc.sql("""
                        SELECT DISTINCT ON (h.booking_id) h.id, h.booking_id, h.held_at, h.held_by
                        FROM door_hold h
                        JOIN unnest(:bookings::uuid[], :opens::timestamptz[], :closes::timestamptz[])
                            AS w(booking_id, opens_at, closes_at) ON w.booking_id = h.booking_id
                        WHERE h.ended_at IS NULL AND h.held_at >= w.opens_at AND h.held_at < w.closes_at
                        ORDER BY h.booking_id, h.held_at DESC
                        """)
                .param("bookings", ordered.stream().map(Window::bookingId).toArray(UUID[]::new))
                .param("opens", ordered.stream().map(window -> Timestamp.from(window.opensAt())).toArray(Timestamp[]::new))
                .param("closes", ordered.stream().map(window -> Timestamp.from(window.closesAt())).toArray(Timestamp[]::new))
                .query((rs, row) -> new Hold(rs.getObject("id", UUID.class), rs.getObject("booking_id", UUID.class),
                        rs.getTimestamp("held_at").toInstant(), rs.getObject("held_by", UUID.class)))
                .list();
    }

    Optional<Hold> unendedSince(Window window) {
        return unendedSince(List.of(window)).stream().findFirst();
    }

    void start(UUID id, UUID bookingId, UUID heldBy, Instant at) {
        jdbc.sql("UPDATE door_hold SET ended_at = :at, ended_by = :by WHERE booking_id = :booking AND ended_at IS NULL")
                .param("at", Timestamp.from(at)).param("by", heldBy).param("booking", bookingId).update();
        jdbc.sql("INSERT INTO door_hold (id, booking_id, held_at, held_by) VALUES (:id, :booking, :at, :by)")
                .param("id", id)
                .param("booking", bookingId)
                .param("at", Timestamp.from(at))
                .param("by", heldBy)
                .update();
    }

    void end(UUID id, UUID endedBy, Instant at) {
        jdbc.sql("UPDATE door_hold SET ended_at = :at, ended_by = :by WHERE id = :id")
                .param("at", Timestamp.from(at))
                .param("by", endedBy)
                .param("id", id)
                .update();
    }

    List<UUID> unendedOnBookingsEndingAfter(Instant now) {
        return jdbc.sql("""
                        SELECT DISTINCT hold.booking_id FROM door_hold hold
                        JOIN court_allocation allocation ON allocation.booking_id = hold.booking_id
                        WHERE hold.ended_at IS NULL AND hold.held_at > :since AND allocation.ends_at > :now
                        """)
                .param("since", Timestamp.from(now.minus(RUNNING_HOLD_REACH)))
                .param("now", Timestamp.from(now))
                .query(UUID.class).list();
    }

    /** Ends every unended hold of these bookings and answers which holds it ended. */
    List<Hold> endAll(Collection<UUID> bookingIds, UUID endedBy, Instant at) {
        if (bookingIds.isEmpty()) {
            return List.of();
        }
        return jdbc.sql("""
                        UPDATE door_hold SET ended_at = :at, ended_by = :by
                        WHERE booking_id IN (:ids) AND ended_at IS NULL
                        RETURNING id, booking_id, held_at, held_by
                        """)
                .param("at", Timestamp.from(at)).param("by", endedBy).param("ids", bookingIds)
                .query((rs, row) -> new Hold(rs.getObject("id", UUID.class), rs.getObject("booking_id", UUID.class),
                        rs.getTimestamp("held_at").toInstant(), rs.getObject("held_by", UUID.class)))
                .list();
    }

    record Window(UUID bookingId, Instant opensAt, Instant closesAt) {
    }

    record Hold(UUID id, UUID bookingId, Instant heldAt, UUID heldBy) {
    }
}
