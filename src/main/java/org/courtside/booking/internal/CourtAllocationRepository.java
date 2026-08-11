package org.courtside.booking.internal;

import org.courtside.booking.CourtAllocation;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.time.LocalTime;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

public interface CourtAllocationRepository extends JpaRepository<CourtAllocation, UUID> {

    @Query("""
            SELECT a FROM CourtAllocation a
            JOIN FETCH a.booking
            WHERE a.status = org.courtside.booking.BookingStatus.CONFIRMED
              AND a.startsAt >= :from
              AND a.startsAt < :to
            ORDER BY a.startsAt ASC
            """)
    List<CourtAllocation> findConfirmedStartingBetween(@Param("from") Instant from,
                                                       @Param("to") Instant to);

    @Query("""
            SELECT DISTINCT a.courtId FROM CourtAllocation a
            WHERE a.courtId IN :courtIds
              AND a.status = org.courtside.booking.BookingStatus.CONFIRMED
              AND a.startsAt < :endsAt
              AND a.endsAt > :startsAt
            """)
    List<UUID> findOccupiedCourts(@Param("courtIds") Collection<UUID> courtIds,
                                  @Param("startsAt") Instant startsAt,
                                  @Param("endsAt") Instant endsAt);

    @Query("""
            SELECT DISTINCT a.courtId FROM CourtAllocation a
            WHERE a.courtId IN :courtIds
              AND a.status = org.courtside.booking.BookingStatus.CONFIRMED
              AND a.startsAt < :endsAt
              AND a.endsAt > :startsAt
              AND a.booking.id NOT IN :excludedBookingIds
            """)
    List<UUID> findOccupiedCourtsExcluding(@Param("courtIds") Collection<UUID> courtIds,
                                           @Param("startsAt") Instant startsAt,
                                           @Param("endsAt") Instant endsAt,
                                           @Param("excludedBookingIds") Collection<UUID> excludedBookingIds);

    @Query(value = """
            SELECT b.id FROM booking b
            JOIN court_allocation a ON a.booking_id = b.id
            WHERE a.court_id = :courtId
              AND a.status = 'CONFIRMED'
              AND a.starts_at >= :from
            GROUP BY b.id
            HAVING :firstPage = true OR (MIN(a.starts_at), b.id) > (
                SELECT MIN(ca.starts_at), cb.id FROM booking cb
                JOIN court_allocation ca ON ca.booking_id = cb.id
                WHERE cb.id = :cursor
                  AND ca.court_id = :courtId
                  AND ca.status = 'CONFIRMED'
                  AND ca.starts_at >= :from
                GROUP BY cb.id
            )
            ORDER BY MIN(a.starts_at), b.id
            """, nativeQuery = true)
    List<UUID> findImpactBookingIdsByCourt(@Param("courtId") UUID courtId,
                                           @Param("from") Instant from,
                                           @Param("firstPage") boolean firstPage,
                                           @Param("cursor") UUID cursor,
                                           Pageable pageable);

    @Query(value = """
            SELECT COUNT(DISTINCT b.id) FROM booking b
            JOIN court_allocation a ON a.booking_id = b.id
            WHERE a.court_id = :courtId
              AND a.status = 'CONFIRMED'
              AND a.starts_at >= :from
            """, nativeQuery = true)
    long countImpactBookingsByCourt(@Param("courtId") UUID courtId, @Param("from") Instant from);

    @Query(value = """
            SELECT b.id FROM booking b
            JOIN court_allocation a ON a.booking_id = b.id
            WHERE b.card_id = :cardId
              AND a.status = 'CONFIRMED'
              AND a.starts_at >= :from
            GROUP BY b.id
            HAVING :firstPage = true OR (MIN(a.starts_at), b.id) > (
                SELECT MIN(ca.starts_at), cb.id FROM booking cb
                JOIN court_allocation ca ON ca.booking_id = cb.id
                WHERE cb.id = :cursor
                  AND cb.card_id = :cardId
                  AND ca.status = 'CONFIRMED'
                  AND ca.starts_at >= :from
                GROUP BY cb.id
            )
            ORDER BY MIN(a.starts_at), b.id
            """, nativeQuery = true)
    List<UUID> findImpactBookingIdsByCard(@Param("cardId") UUID cardId,
                                          @Param("from") Instant from,
                                          @Param("firstPage") boolean firstPage,
                                          @Param("cursor") UUID cursor,
                                          Pageable pageable);

    @Query(value = """
            SELECT COUNT(DISTINCT b.id) FROM booking b
            JOIN court_allocation a ON a.booking_id = b.id
            WHERE b.card_id = :cardId
              AND a.status = 'CONFIRMED'
              AND a.starts_at >= :from
            """, nativeQuery = true)
    long countImpactBookingsByCard(@Param("cardId") UUID cardId, @Param("from") Instant from);

    @Query(value = """
            SELECT b.id FROM booking b
            JOIN court_allocation a ON a.booking_id = b.id
            WHERE a.status = 'CONFIRMED'
              AND a.starts_at >= :from
              AND date_part('isodow', timezone(:zone, a.starts_at)) = :isoDayOfWeek
              AND (:closed = true OR CAST(timezone(:zone, a.starts_at) AS time) < :opensAt
                   OR CAST(timezone(:zone, a.ends_at) AS time) > :closesAt)
            GROUP BY b.id
            HAVING :firstPage = true OR (MIN(a.starts_at), b.id) > (
                SELECT MIN(ca.starts_at), cb.id FROM booking cb
                JOIN court_allocation ca ON ca.booking_id = cb.id
                WHERE cb.id = :cursor
                  AND ca.status = 'CONFIRMED'
                  AND ca.starts_at >= :from
                  AND date_part('isodow', timezone(:zone, ca.starts_at)) = :isoDayOfWeek
                  AND (:closed = true OR CAST(timezone(:zone, ca.starts_at) AS time) < :opensAt
                       OR CAST(timezone(:zone, ca.ends_at) AS time) > :closesAt)
                GROUP BY cb.id
            )
            ORDER BY MIN(a.starts_at), b.id
            """, nativeQuery = true)
    List<UUID> findImpactBookingIdsByOpeningHours(@Param("from") Instant from,
                                                  @Param("zone") String zone,
                                                  @Param("isoDayOfWeek") int isoDayOfWeek,
                                                  @Param("closed") boolean closed,
                                                  @Param("opensAt") LocalTime opensAt,
                                                  @Param("closesAt") LocalTime closesAt,
                                                  @Param("firstPage") boolean firstPage,
                                                  @Param("cursor") UUID cursor,
                                                  Pageable pageable);

    @Query(value = """
            SELECT COUNT(DISTINCT b.id) FROM booking b
            JOIN court_allocation a ON a.booking_id = b.id
            WHERE a.status = 'CONFIRMED'
              AND a.starts_at >= :from
              AND date_part('isodow', timezone(:zone, a.starts_at)) = :isoDayOfWeek
              AND (:closed = true OR CAST(timezone(:zone, a.starts_at) AS time) < :opensAt
                   OR CAST(timezone(:zone, a.ends_at) AS time) > :closesAt)
            """, nativeQuery = true)
    long countImpactBookingsByOpeningHours(@Param("from") Instant from,
                                            @Param("zone") String zone,
                                            @Param("isoDayOfWeek") int isoDayOfWeek,
                                            @Param("closed") boolean closed,
                                            @Param("opensAt") LocalTime opensAt,
                                            @Param("closesAt") LocalTime closesAt);

    @Query("""
            SELECT a FROM CourtAllocation a
            JOIN FETCH a.booking b
            WHERE b.id IN :bookingIds
            ORDER BY a.startsAt, a.courtId
            """)
    List<CourtAllocation> findAllByBookingIdIn(@Param("bookingIds") Collection<UUID> bookingIds);
}
