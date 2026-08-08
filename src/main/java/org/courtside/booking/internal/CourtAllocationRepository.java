package org.courtside.booking.internal;

import org.courtside.booking.CourtAllocation;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
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

    @Query("""
            SELECT a FROM CourtAllocation a
            JOIN FETCH a.booking b
            WHERE a.courtId = :courtId
              AND a.status = org.courtside.booking.BookingStatus.CONFIRMED
              AND a.startsAt >= :from
            ORDER BY a.startsAt ASC
            """)
    List<CourtAllocation> findConfirmedFutureByCourt(@Param("courtId") UUID courtId,
                                                     @Param("from") Instant from);

    @Query("""
            SELECT a FROM CourtAllocation a
            JOIN FETCH a.booking b
            WHERE b.cardId = :cardId
              AND a.status = org.courtside.booking.BookingStatus.CONFIRMED
              AND a.startsAt >= :from
            ORDER BY a.startsAt ASC
            """)
    List<CourtAllocation> findConfirmedFutureByCard(@Param("cardId") UUID cardId,
                                                    @Param("from") Instant from);

    @Query("""
            SELECT a FROM CourtAllocation a
            JOIN FETCH a.booking b
            WHERE a.status = org.courtside.booking.BookingStatus.CONFIRMED
              AND a.startsAt >= :from
              AND function('date_part', 'isodow', function('timezone', :zone, a.startsAt)) = :isoDayOfWeek
            ORDER BY a.startsAt ASC
            """)
    List<CourtAllocation> findConfirmedFutureOnWeekday(@Param("from") Instant from,
                                                       @Param("zone") String zone,
                                                       @Param("isoDayOfWeek") int isoDayOfWeek);
}
