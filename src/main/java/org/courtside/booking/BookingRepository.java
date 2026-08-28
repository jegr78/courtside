package org.courtside.booking;

import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.data.domain.Pageable;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.Set;
import org.courtside.identity.Role;

public interface BookingRepository extends JpaRepository<Booking, UUID> {

    @EntityGraph(attributePaths = "allocations")
    Optional<Booking> findWithAllocationsById(UUID id);

    @EntityGraph(attributePaths = "participants")
    Optional<Booking> findWithParticipantsById(UUID id);

    // A booking made when it already stood inside its own lead time was announced by its
    // confirmation, so a reminder minutes later would only repeat it.
    @Query(value = """
            SELECT DISTINCT b.id FROM booking b
            JOIN court_allocation a ON a.booking_id = b.id
            WHERE b.status = 'CONFIRMED'
              AND b.reminded_at IS NULL
              AND a.status = 'CONFIRMED'
              AND a.starts_at >= :now
              AND a.starts_at <= cast(:now AS timestamptz) + make_interval(hours => :leadHours)
              AND b.created_at + make_interval(hours => :leadHours) <= a.starts_at
            """, nativeQuery = true)
    List<UUID> findDueForReminder(@Param("now") Instant now, @Param("leadHours") int leadHours);

    // The claim is the guard: whoever changes the row from null is the one that sends, so a second
    // sweep - or a second instance - finds nothing to do.
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = "UPDATE booking SET reminded_at = :at WHERE id = :id AND reminded_at IS NULL",
            nativeQuery = true)
    int claimReminder(@Param("id") UUID id, @Param("at") Instant at);

    @Query("""
            SELECT count(b) FROM Booking b
            WHERE b.bookedBy = :bookedBy
              AND b.status = org.courtside.booking.BookingStatus.CONFIRMED
              AND EXISTS (SELECT 1 FROM CourtAllocation a
                          WHERE a.booking = b AND a.endsAt > :now)
              AND EXISTS (SELECT 1 FROM BookingCard c
                          WHERE c.id = b.cardId AND c.countsAgainstLimits = true)
            """)
    long countOpenBookings(@Param("bookedBy") UUID bookedBy, @Param("now") Instant now);

    @Query("""
            SELECT p.booking.id, count(p) FROM BookingParticipant p
            WHERE p.booking.id IN :bookingIds
            GROUP BY p.booking.id
            """)
    List<Object[]> countParticipantsByBooking(@Param("bookingIds") Collection<UUID> bookingIds);

    @Query("""
            SELECT p.booking.id, p.personId FROM BookingParticipant p
            WHERE p.booking.id IN :bookingIds
              AND p.personId IS NOT NULL
            ORDER BY p.booking.id, p.position
            """)
    List<Object[]> findMemberParticipantIdsByBooking(@Param("bookingIds") Collection<UUID> bookingIds);

    @Query("""
            SELECT count(distinct p) FROM BookingParticipant p
            JOIN p.booking b
            JOIN b.allocations a
            WHERE p.cardId = :cardId
              AND b.status = org.courtside.booking.BookingStatus.CONFIRMED
              AND a.status = org.courtside.booking.BookingStatus.CONFIRMED
              AND a.startsAt < :endsAt
              AND a.endsAt > :startsAt
            """)
    long countCardUsageOverlapping(@Param("cardId") UUID cardId,
                                   @Param("startsAt") Instant startsAt,
                                   @Param("endsAt") Instant endsAt);

    @Query("""
            SELECT count(distinct p) FROM BookingParticipant p
            JOIN p.booking b
            JOIN b.allocations a
            WHERE p.cardId = :cardId
              AND b.id NOT IN :excludedBookingIds
              AND b.status = org.courtside.booking.BookingStatus.CONFIRMED
              AND a.status = org.courtside.booking.BookingStatus.CONFIRMED
              AND a.startsAt < :endsAt
              AND a.endsAt > :startsAt
            """)
    long countCardUsageOverlappingExcluding(@Param("cardId") UUID cardId,
                                            @Param("startsAt") Instant startsAt,
                                            @Param("endsAt") Instant endsAt,
                                            @Param("excludedBookingIds") Collection<UUID> excludedBookingIds);

    @EntityGraph(attributePaths = "allocations")
    @Query("""
            SELECT b FROM Booking b
            WHERE b.seriesId = :seriesId
              AND b.status = org.courtside.booking.BookingStatus.CONFIRMED
            ORDER BY (SELECT min(a.startsAt) FROM CourtAllocation a WHERE a.booking = b) ASC
            """)
    List<Booking> findConfirmedBySeriesOrderedByStart(@Param("seriesId") UUID seriesId);

    @Query("""
            SELECT b.id FROM Booking b
            WHERE b.bookedBy = :bookedBy
              AND (:cursor IS NULL
                OR ((SELECT min(a.startsAt) FROM CourtAllocation a WHERE a.booking = b), b.id)
                    < ((SELECT min(ca.startsAt) FROM CourtAllocation ca
                        WHERE ca.booking.id = :cursor
                          AND ca.booking.bookedBy = :bookedBy), :cursor))
            ORDER BY (SELECT min(a.startsAt) FROM CourtAllocation a WHERE a.booking = b) DESC,
                     b.id DESC
            """)
    List<UUID> findPersonalBookingIds(@Param("bookedBy") UUID bookedBy,
                                      @Param("cursor") UUID cursor,
                                      Pageable pageable);

    @Query("""
            SELECT b.id FROM Booking b
            WHERE (:administrator = true OR EXISTS (
                SELECT c.id FROM BookingCard c JOIN c.managingRoles role
                WHERE c.id = b.cardId AND role IN :roles
            ))
              AND (:cursor IS NULL
                OR ((SELECT min(a.startsAt) FROM CourtAllocation a WHERE a.booking = b), b.id)
                    < ((SELECT min(ca.startsAt) FROM CourtAllocation ca
                        WHERE ca.booking.id = :cursor
                          AND (:administrator = true OR EXISTS (
                            SELECT cc.id FROM BookingCard cc JOIN cc.managingRoles cursorRole
                            WHERE cc.id = ca.booking.cardId AND cursorRole IN :roles
                          ))), :cursor))
            ORDER BY (SELECT min(a.startsAt) FROM CourtAllocation a WHERE a.booking = b) DESC,
                     b.id DESC
            """)
    List<UUID> findManagedBookingIds(@Param("roles") Set<Role> roles,
                                     @Param("administrator") boolean administrator,
                                     @Param("cursor") UUID cursor,
                                     Pageable pageable);

    @Query("""
            SELECT b.id FROM Booking b
            WHERE EXISTS (SELECT p.id FROM BookingParticipant p
                          WHERE p.booking = b AND p.personId = :personId)
              AND (b.bookedBy IS NULL OR b.bookedBy <> :accountId)
              AND (:cursor IS NULL
                OR ((SELECT min(a.startsAt) FROM CourtAllocation a WHERE a.booking = b), b.id)
                    < ((SELECT min(ca.startsAt) FROM CourtAllocation ca
                        WHERE ca.booking.id = :cursor
                          AND EXISTS (SELECT cp.id FROM BookingParticipant cp
                                      WHERE cp.booking = ca.booking AND cp.personId = :personId)
                          AND (ca.booking.bookedBy IS NULL
                               OR ca.booking.bookedBy <> :accountId)), :cursor))
            ORDER BY (SELECT min(a.startsAt) FROM CourtAllocation a WHERE a.booking = b) DESC,
                     b.id DESC
            """)
    List<UUID> findParticipationIds(@Param("personId") UUID personId,
                                    @Param("accountId") UUID accountId,
                                    @Param("cursor") UUID cursor,
                                    Pageable pageable);

    @EntityGraph(attributePaths = "allocations")
    List<Booking> findAllByIdIn(Collection<UUID> ids);

    @EntityGraph(attributePaths = "allocations")
    List<Booking> findByBookedByOrderByCreatedAtAscIdAsc(UUID bookedBy);

    @EntityGraph(attributePaths = "allocations")
    @Query("""
            SELECT b FROM Booking b
            WHERE EXISTS (SELECT p.id FROM BookingParticipant p
                          WHERE p.booking = b AND p.personId = :personId)
            ORDER BY b.createdAt ASC, b.id ASC
            """)
    List<Booking> findNamingParticipant(@Param("personId") UUID personId);

    boolean existsByIdAndSeriesId(UUID id, UUID seriesId);

    Optional<Booking> findByBookedByAndIdempotencyKey(UUID bookedBy, String idempotencyKey);
}
