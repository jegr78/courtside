package org.courtside.booking.waitlist;

import lombok.RequiredArgsConstructor;
import org.courtside.booking.ParticipantSpec;
import org.courtside.booking.internal.ParticipantKind;
import org.courtside.shared.TimeSlot;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Component
@RequiredArgsConstructor
class WaitlistRows {

    private static final String COLUMNS = """
            id, account_id, court_id, card_id, starts_at, ends_at, note, state, offer_expires_at, booking_id
            """;
    private static final RowMapper<WaitlistEntry> ENTRY = WaitlistRows::entry;

    private final JdbcClient jdbc;

    void insert(UUID id, JoinWaitlistCommand command, Instant joinedAt) {
        jdbc.sql("""
                        INSERT INTO waitlist_entry
                            (id, account_id, court_id, card_id, starts_at, ends_at, note, state, joined_at)
                        VALUES (:id, :accountId, :courtId, :cardId, :startsAt, :endsAt, :note, 'WAITING', :joinedAt)
                        """)
                .param("id", id)
                .param("accountId", command.accountId())
                .param("courtId", command.courtId())
                .param("cardId", command.cardId())
                .param("startsAt", timestamp(command.slot().start()))
                .param("endsAt", timestamp(command.slot().end()))
                .param("note", command.note())
                .param("joinedAt", timestamp(joinedAt))
                .update();
        List<ParticipantSpec> participants = command.participants();
        for (int position = 0; position < participants.size(); position++) {
            ParticipantSpec participant = participants.get(position);
            jdbc.sql("""
                            INSERT INTO waitlist_participant (entry_id, position, kind, person_id, guest_name, card_id)
                            VALUES (:entryId, :position, :kind, :personId, :guestName, :cardId)
                            """)
                    .param("entryId", id)
                    .param("position", position)
                    .param("kind", participant.kind().name())
                    .param("personId", participant.personId())
                    .param("guestName", participant.guestName())
                    .param("cardId", participant.cardId())
                    .update();
        }
    }

    Optional<WaitlistEntry> lockOwn(UUID id, UUID accountId) {
        return jdbc.sql("SELECT " + COLUMNS + " FROM waitlist_entry WHERE id = :id AND account_id = :accountId FOR UPDATE")
                .param("id", id)
                .param("accountId", accountId)
                .query(ENTRY)
                .optional();
    }

    Optional<WaitlistEntry> find(UUID id) {
        return jdbc.sql("SELECT " + COLUMNS + " FROM waitlist_entry WHERE id = :id")
                .param("id", id)
                .query(ENTRY)
                .optional();
    }

    List<WaitlistEntry> findOwn(UUID accountId, Collection<UUID> ids) {
        if (ids.isEmpty()) {
            return List.of();
        }
        return jdbc.sql("SELECT " + COLUMNS + " FROM waitlist_entry WHERE account_id = :accountId AND id IN (:ids)")
                .param("accountId", accountId)
                .param("ids", ids)
                .query(ENTRY)
                .list();
    }

    List<ParticipantSpec> participants(UUID entryId) {
        return jdbc.sql("""
                        SELECT kind, person_id, guest_name, card_id FROM waitlist_participant
                        WHERE entry_id = :entryId ORDER BY position
                        """)
                .param("entryId", entryId)
                .query((row, number) -> new ParticipantSpec(ParticipantKind.valueOf(row.getString("kind")),
                        row.getObject("person_id", UUID.class), row.getString("guest_name"),
                        row.getObject("card_id", UUID.class)))
                .list();
    }

    List<WaitlistEntry> ownNotEnded(UUID accountId, Instant now) {
        return jdbc.sql("SELECT " + COLUMNS + """
                         FROM waitlist_entry
                        WHERE account_id = :accountId AND ends_at > :now
                        ORDER BY starts_at, court_id, joined_seq
                        """)
                .param("accountId", accountId)
                .param("now", timestamp(now))
                .query(ENTRY)
                .list();
    }

    int countNotEnded(UUID accountId, Instant now) {
        return jdbc.sql("SELECT count(*) FROM waitlist_entry WHERE account_id = :accountId AND ends_at > :now")
                .param("accountId", accountId)
                .param("now", timestamp(now))
                .query(Integer.class)
                .single();
    }

    List<WaitlistEntry> offeredBetween(Instant from, Instant to) {
        return jdbc.sql("SELECT " + COLUMNS + """
                         FROM waitlist_entry
                        WHERE state = 'OFFERED' AND starts_at < :to AND ends_at > :from
                        ORDER BY starts_at, court_id
                        """)
                .param("from", timestamp(from))
                .param("to", timestamp(to))
                .query(ENTRY)
                .list();
    }

    List<UUID> offeredCourts(Collection<UUID> courtIds, TimeSlot slot, UUID exceptAccountId) {
        if (courtIds.isEmpty()) {
            return List.of();
        }
        return jdbc.sql("""
                        SELECT DISTINCT court_id FROM waitlist_entry
                        WHERE state = 'OFFERED' AND court_id IN (:courtIds)
                          AND starts_at < :endsAt AND ends_at > :startsAt
                          AND (CAST(:accountId AS uuid) IS NULL OR account_id <> CAST(:accountId AS uuid))
                        """)
                .param("courtIds", courtIds)
                .param("startsAt", timestamp(slot.start()))
                .param("endsAt", timestamp(slot.end()))
                .param("accountId", exceptAccountId)
                .query(UUID.class)
                .list();
    }

    boolean offerOverlap(UUID courtId, TimeSlot slot, UUID heldBy) {
        return jdbc.sql("""
                        SELECT EXISTS (
                            SELECT 1 FROM waitlist_entry
                            WHERE court_id = :courtId AND state = 'OFFERED'
                              AND starts_at < :endsAt AND ends_at > :startsAt
                              AND (CAST(:heldBy AS uuid) IS NULL OR account_id = CAST(:heldBy AS uuid)))
                        """)
                .param("courtId", courtId)
                .param("startsAt", timestamp(slot.start()))
                .param("endsAt", timestamp(slot.end()))
                .param("heldBy", heldBy)
                .query(Boolean.class)
                .single();
    }

    boolean confirmedOverlap(UUID courtId, TimeSlot slot, UUID bookedBy) {
        return jdbc.sql("""
                        SELECT EXISTS (
                            SELECT 1 FROM court_allocation a JOIN booking b ON b.id = a.booking_id
                            WHERE a.court_id = :courtId AND a.status = 'CONFIRMED'
                              AND a.starts_at < :endsAt AND a.ends_at > :startsAt
                              AND (CAST(:bookedBy AS uuid) IS NULL OR b.booked_by = CAST(:bookedBy AS uuid)))
                        """)
                .param("courtId", courtId)
                .param("startsAt", timestamp(slot.start()))
                .param("endsAt", timestamp(slot.end()))
                .param("bookedBy", bookedBy)
                .query(Boolean.class)
                .single();
    }

    // The courts' time may be free while a slot queued for is not: only a whole free slot is offered.
    List<Queue> freeQueues(Collection<UUID> courtIds, TimeSlot window, Instant now) {
        return jdbc.sql("""
                        SELECT w.court_id, w.starts_at, w.ends_at, min(w.joined_seq) AS first_joined
                        FROM waitlist_entry w
                        WHERE w.state = 'WAITING' AND w.starts_at > :now
                          AND (:anyCourt OR w.court_id IN (:courtIds))
                          AND (CAST(:windowStart AS timestamptz) IS NULL
                               OR (w.starts_at < CAST(:windowEnd AS timestamptz)
                                   AND w.ends_at > CAST(:windowStart AS timestamptz)))
                          AND NOT EXISTS (
                              SELECT 1 FROM court_allocation a
                              WHERE a.court_id = w.court_id AND a.status = 'CONFIRMED'
                                AND a.starts_at < w.ends_at AND a.ends_at > w.starts_at)
                        GROUP BY w.court_id, w.starts_at, w.ends_at
                        ORDER BY first_joined
                        """)
                .param("now", timestamp(now))
                .param("anyCourt", courtIds == null)
                .param("courtIds", courtIds == null || courtIds.isEmpty() ? List.of(new UUID(0, 0)) : courtIds)
                .param("windowStart", window == null ? null : timestamp(window.start()))
                .param("windowEnd", window == null ? null : timestamp(window.end()))
                .query((row, number) -> new Queue(row.getObject("court_id", UUID.class),
                        new TimeSlot(instant(row, "starts_at"), instant(row, "ends_at"))))
                .list();
    }

    List<WaitlistEntry> lockWaiting(Queue queue) {
        return jdbc.sql("SELECT " + COLUMNS + """
                         FROM waitlist_entry
                        WHERE court_id = :courtId AND starts_at = :startsAt AND ends_at = :endsAt AND state = 'WAITING'
                        ORDER BY joined_seq
                        FOR UPDATE
                        """)
                .param("courtId", queue.courtId())
                .param("startsAt", timestamp(queue.slot().start()))
                .param("endsAt", timestamp(queue.slot().end()))
                .query(ENTRY)
                .list();
    }

    void offer(UUID id, Instant now, Instant expiresAt) {
        jdbc.sql("""
                        UPDATE waitlist_entry SET state = 'OFFERED', offered_at = :now, offer_expires_at = :expiresAt
                        WHERE id = :id AND state = 'WAITING'
                        """)
                .param("id", id)
                .param("now", timestamp(now))
                .param("expiresAt", timestamp(expiresAt))
                .update();
    }

    void close(UUID id, WaitlistState state, Instant now) {
        jdbc.sql("""
                        UPDATE waitlist_entry SET state = :state, closed_at = :now
                        WHERE id = :id AND state IN ('WAITING', 'OFFERED')
                        """)
                .param("id", id)
                .param("state", state.name())
                .param("now", timestamp(now))
                .update();
    }

    // The previous state comes back, so a caller can tell whether a reservation ended with it.
    List<WaitlistEntry> closeOpenOverlapping(UUID accountId, Collection<UUID> courtIds, TimeSlot slot,
                                             UUID bookingId, Instant now) {
        return jdbc.sql("""
                        WITH closing AS (
                            SELECT id, state FROM waitlist_entry
                            WHERE account_id = :accountId AND court_id IN (:courtIds)
                              AND state IN ('WAITING', 'OFFERED')
                              AND starts_at < :endsAt AND ends_at > :startsAt
                            FOR UPDATE)
                        UPDATE waitlist_entry w SET state = 'BOOKED', closed_at = :now, booking_id = :bookingId
                        FROM closing
                        WHERE w.id = closing.id
                        RETURNING w.id, w.account_id, w.court_id, w.card_id, w.starts_at, w.ends_at, w.note,
                                  closing.state, w.offer_expires_at, w.booking_id
                        """)
                .param("accountId", accountId)
                .param("courtIds", courtIds)
                .param("startsAt", timestamp(slot.start()))
                .param("endsAt", timestamp(slot.end()))
                .param("bookingId", bookingId)
                .param("now", timestamp(now))
                .query(ENTRY)
                .list();
    }

    int expireDue(Instant now) {
        return jdbc.sql("""
                        UPDATE waitlist_entry SET state = 'EXPIRED', closed_at = :now
                        WHERE state = 'OFFERED' AND offer_expires_at <= :now
                        """)
                .param("now", timestamp(now))
                .update();
    }

    int endStarted(Instant now) {
        return jdbc.sql("""
                        UPDATE waitlist_entry SET state = 'ENDED', closed_at = :now
                        WHERE state = 'WAITING' AND starts_at <= :now
                        """)
                .param("now", timestamp(now))
                .update();
    }

    int deleteEnded(Instant now) {
        return jdbc.sql("DELETE FROM waitlist_entry WHERE ends_at <= :now")
                .param("now", timestamp(now))
                .update();
    }

    record Queue(UUID courtId, TimeSlot slot) {
    }

    private static WaitlistEntry entry(ResultSet row, int number) throws SQLException {
        return new WaitlistEntry(row.getObject("id", UUID.class), row.getObject("account_id", UUID.class),
                row.getObject("court_id", UUID.class), row.getObject("card_id", UUID.class),
                new TimeSlot(instant(row, "starts_at"), instant(row, "ends_at")), row.getString("note"),
                WaitlistState.valueOf(row.getString("state")), instant(row, "offer_expires_at"),
                row.getObject("booking_id", UUID.class));
    }

    private static Instant instant(ResultSet row, String column) throws SQLException {
        Timestamp value = row.getTimestamp(column);
        return value == null ? null : value.toInstant();
    }

    private static Timestamp timestamp(Instant instant) {
        return Timestamp.from(instant);
    }
}
