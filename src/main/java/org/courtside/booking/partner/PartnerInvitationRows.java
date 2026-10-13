package org.courtside.booking.partner;

import lombok.RequiredArgsConstructor;
import org.courtside.shared.TimeSlot;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

import java.sql.Array;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Arrays;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;

@Component
@RequiredArgsConstructor
class PartnerInvitationRows {

    private final JdbcClient jdbc;

    void insert(UUID id, UUID bookingId, UUID participantId, Instant publishedAt) {
        jdbc.sql("""
                        INSERT INTO partner_invitation (id, booking_id, participant_id, published_at)
                        VALUES (:id, :bookingId, :participantId, :publishedAt)
                        """)
                .param("id", id)
                .param("bookingId", bookingId)
                .param("participantId", participantId)
                .param("publishedAt", Timestamp.from(publishedAt))
                .update();
    }

    Optional<UUID> forBooking(UUID bookingId) {
        return jdbc.sql("SELECT id FROM partner_invitation WHERE booking_id = :bookingId")
                .param("bookingId", bookingId)
                .query(UUID.class)
                .optional();
    }

    Optional<Invitation> find(UUID id) {
        return jdbc.sql("SELECT id, booking_id, participant_id FROM partner_invitation WHERE id = :id")
                .param("id", id)
                .query((row, number) -> new Invitation(row.getObject("id", UUID.class),
                        row.getObject("booking_id", UUID.class), row.getObject("participant_id", UUID.class)))
                .optional();
    }

    void delete(UUID id) {
        jdbc.sql("DELETE FROM partner_invitation WHERE id = :id").param("id", id).update();
    }

    void deleteForBooking(UUID bookingId) {
        jdbc.sql("DELETE FROM partner_invitation WHERE booking_id = :bookingId").param("bookingId", bookingId).update();
    }

    // Everything nobody can take any more: its booking is gone, was cancelled, has started or lost the marker.
    int deleteClosed(Instant now) {
        return jdbc.sql("""
                        DELETE FROM partner_invitation i
                        WHERE NOT EXISTS (SELECT 1 FROM booking b WHERE b.id = i.booking_id AND b.status = 'CONFIRMED')
                           OR EXISTS (SELECT 1 FROM court_allocation a
                                      WHERE a.booking_id = i.booking_id AND a.starts_at <= :now)
                           OR NOT EXISTS (SELECT 1 FROM booking_participant p
                                          WHERE p.id = i.participant_id AND p.card_id IS NOT NULL)
                        """)
                .param("now", Timestamp.from(now))
                .update();
    }

    // Candidates only: whether the viewer may book the card is decided by the caller.
    List<Candidate> offeredBeyond(UUID accountId, UUID personId, Instant now) {
        return jdbc.sql("""
                        SELECT i.id, b.card_id, min(a.starts_at) AS starts_at, max(a.ends_at) AS ends_at,
                               array_agg(a.court_id ORDER BY a.court_id) AS court_ids
                        FROM partner_invitation i
                        JOIN booking b ON b.id = i.booking_id
                        JOIN court_allocation a ON a.booking_id = b.id
                        JOIN booking_participant marker ON marker.id = i.participant_id AND marker.card_id IS NOT NULL
                        WHERE b.status = 'CONFIRMED' AND b.series_id IS NULL AND b.booked_by <> :accountId
                          AND NOT EXISTS (SELECT 1 FROM booking_participant p
                                          WHERE p.booking_id = b.id AND p.person_id = :personId)
                        GROUP BY i.id, b.card_id
                        HAVING min(a.starts_at) > :now
                        ORDER BY min(a.starts_at), i.id
                        """)
                .param("accountId", accountId)
                .param("personId", personId)
                .param("now", Timestamp.from(now))
                .query((row, number) -> new Candidate(row.getObject("id", UUID.class),
                        row.getObject("card_id", UUID.class),
                        new TimeSlot(row.getTimestamp("starts_at").toInstant(), row.getTimestamp("ends_at").toInstant()),
                        uuids(row.getArray("court_ids"))))
                .list();
    }

    Map<UUID, PartnerSearchState> searchStates(Collection<UUID> bookingIds, UUID markerCardId, Instant now) {
        return jdbc.sql("""
                        SELECT p.booking_id, EXISTS (SELECT 1 FROM partner_invitation i
                                                     WHERE i.booking_id = p.booking_id) AS published
                        FROM booking_participant p
                        JOIN booking b ON b.id = p.booking_id
                        WHERE p.booking_id IN (:bookingIds) AND p.card_id = :markerCardId
                          AND b.status = 'CONFIRMED' AND b.series_id IS NULL
                          AND NOT EXISTS (SELECT 1 FROM court_allocation a
                                          WHERE a.booking_id = b.id AND a.starts_at <= :now)
                        """)
                .param("bookingIds", bookingIds)
                .param("markerCardId", markerCardId)
                .param("now", Timestamp.from(now))
                .query((row, number) -> Map.entry(row.getObject("booking_id", UUID.class),
                        row.getBoolean("published") ? PartnerSearchState.PUBLISHED : PartnerSearchState.AVAILABLE))
                .list().stream()
                .collect(Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue, (first, second) -> first));
    }

    private static List<UUID> uuids(Array array) throws SQLException {
        return Arrays.stream((Object[]) array.getArray()).map(UUID.class::cast).toList();
    }

    record Invitation(UUID id, UUID bookingId, UUID participantId) {
    }

    record Candidate(UUID invitationId, UUID cardId, TimeSlot slot, List<UUID> courtIds) {
    }
}
