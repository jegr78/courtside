package org.courtside.booking;

import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
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
                OR (SELECT min(a.startsAt) FROM CourtAllocation a WHERE a.booking = b)
                    < (SELECT min(ca.startsAt) FROM CourtAllocation ca
                       WHERE ca.booking.id = :cursor AND ca.booking.bookedBy = :bookedBy)
                OR ((SELECT min(a.startsAt) FROM CourtAllocation a WHERE a.booking = b)
                    = (SELECT min(ca.startsAt) FROM CourtAllocation ca
                       WHERE ca.booking.id = :cursor AND ca.booking.bookedBy = :bookedBy)
                    AND b.id < :cursor))
            ORDER BY (SELECT min(a.startsAt) FROM CourtAllocation a WHERE a.booking = b) DESC,
                     b.id DESC
            """)
    List<UUID> findPersonalBookingIds(@Param("bookedBy") UUID bookedBy,
                                      @Param("cursor") UUID cursor,
                                      Pageable pageable);

    @Query("""
            SELECT b.id FROM Booking b
            WHERE (:administrator = true OR EXISTS (
                SELECT c.id FROM BookingCard c JOIN c.allowedRoles role
                WHERE c.id = b.cardId AND role IN :roles
            ))
              AND (:cursor IS NULL
                OR (SELECT min(a.startsAt) FROM CourtAllocation a WHERE a.booking = b)
                    < (SELECT min(ca.startsAt) FROM CourtAllocation ca WHERE ca.booking.id = :cursor)
                OR ((SELECT min(a.startsAt) FROM CourtAllocation a WHERE a.booking = b)
                    = (SELECT min(ca.startsAt) FROM CourtAllocation ca WHERE ca.booking.id = :cursor)
                    AND b.id < :cursor))
            ORDER BY (SELECT min(a.startsAt) FROM CourtAllocation a WHERE a.booking = b) DESC,
                     b.id DESC
            """)
    List<UUID> findManagedBookingIds(@Param("roles") Set<Role> roles,
                                     @Param("administrator") boolean administrator,
                                     @Param("cursor") UUID cursor,
                                     Pageable pageable);

    @EntityGraph(attributePaths = "allocations")
    List<Booking> findAllByIdIn(Collection<UUID> ids);

    boolean existsByIdAndSeriesId(UUID id, UUID seriesId);

    Optional<Booking> findByBookedByAndIdempotencyKey(UUID bookedBy, String idempotencyKey);
}
