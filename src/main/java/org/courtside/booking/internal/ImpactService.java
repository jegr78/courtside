package org.courtside.booking.internal;

import org.courtside.booking.CourtAllocation;
import org.courtside.card.CardNotFoundException;
import org.courtside.card.CardService;
import org.courtside.facility.CourtNotFoundException;
import org.courtside.facility.FacilityService;
import org.courtside.shared.OpeningWindow;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;
import org.courtside.config.ClubTimeZone;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
@Transactional(readOnly = true)
public class ImpactService {

    private static final int MAX_PAGE_SIZE = 100;
    private static final UUID FIRST_PAGE_CURSOR = new UUID(0, 0);

    private final CourtAllocationRepository allocations;
    private final FacilityService facility;
    private final CardService cards;
    private final Clock clock;
    private final ClubTimeZone timeZone;

    public ImpactService(CourtAllocationRepository allocations, FacilityService facility,
                         CardService cards, Clock clock, ClubTimeZone timeZone) {
        this.allocations = allocations;
        this.facility = facility;
        this.cards = cards;
        this.clock = clock;
        this.timeZone = timeZone;
    }

    public record AffectedBooking(UUID bookingId, List<UUID> courtIds, Instant startsAt, Instant endsAt) {
    }

    public record Impact(int affectedCount, boolean truncated, UUID nextCursor, List<AffectedBooking> bookings) {
    }

    public Impact ofDeactivating(UUID courtId, UUID cursor, int limit) {
        validateLimit(limit);
        facility.findCourt(courtId).orElseThrow(
                () -> new CourtNotFoundException("No court with id " + courtId));
        Instant from = clock.instant();
        return impactOf(allocations.findImpactBookingIdsByCourt(
                        courtId, from, cursor == null, cursorOrFirstPage(cursor), page(limit)),
                allocations.countImpactBookingsByCourt(courtId, from), limit);
    }

    public Impact ofRetiringCard(UUID cardId, UUID cursor, int limit) {
        validateLimit(limit);
        cards.findCard(cardId).orElseThrow(
                () -> new CardNotFoundException("No booking card with id " + cardId));
        Instant from = clock.instant();
        return impactOf(allocations.findImpactBookingIdsByCard(
                        cardId, from, cursor == null, cursorOrFirstPage(cursor), page(limit)),
                allocations.countImpactBookingsByCard(cardId, from), limit);
    }

    public Impact ofClosingWeekday(DayOfWeek day, UUID cursor, int limit) {
        return openingHoursImpact(day, true, LocalTime.MIN, LocalTime.MAX, cursor, limit);
    }

    public Impact ofOpeningHours(DayOfWeek day, OpeningWindow window, UUID cursor, int limit) {
        OpeningWindow required = OpeningWindow.required(window);
        return openingHoursImpact(day, false, required.opensAt(), required.closesAt(), cursor, limit);
    }

    private Impact openingHoursImpact(DayOfWeek day, boolean closed, LocalTime opensAt, LocalTime closesAt,
                                      UUID cursor, int limit) {
        validateLimit(limit);
        Instant from = clock.instant();
        List<UUID> bookingIds = allocations.findImpactBookingIdsByOpeningHours(
                from, timeZone.id(), day.getValue(), closed, opensAt, closesAt,
                cursor == null, cursorOrFirstPage(cursor), page(limit));
        long affectedCount = allocations.countImpactBookingsByOpeningHours(
                from, timeZone.id(), day.getValue(), closed, opensAt, closesAt);
        return impactOf(bookingIds, affectedCount, limit);
    }

    private Impact impactOf(List<UUID> bookingIds, long affectedCount, int limit) {
        boolean truncated = bookingIds.size() > limit;
        List<UUID> visibleIds = truncated ? bookingIds.subList(0, limit) : bookingIds;
        Map<UUID, List<CourtAllocation>> allocationsByBooking = new HashMap<>();
        if (!visibleIds.isEmpty()) {
            allocations.findAllByBookingIdIn(visibleIds).forEach(allocation ->
                    allocationsByBooking.computeIfAbsent(
                            allocation.getBooking().getId(), ignored -> new ArrayList<>())
                            .add(allocation));
        }
        List<AffectedBooking> listed = visibleIds.stream()
                .map(allocationsByBooking::get)
                .map(ImpactService::toAffectedBooking)
                .toList();
        UUID nextCursor = truncated ? visibleIds.getLast() : null;
        return new Impact(Math.toIntExact(affectedCount), truncated, nextCursor, listed);
    }

    private static PageRequest page(int limit) {
        return PageRequest.of(0, limit + 1);
    }

    private static UUID cursorOrFirstPage(UUID cursor) {
        return cursor == null ? FIRST_PAGE_CURSOR : cursor;
    }

    private static void validateLimit(int limit) {
        if (limit < 1 || limit > MAX_PAGE_SIZE) {
            throw new IllegalStateException("Impact page size must be between 1 and " + MAX_PAGE_SIZE);
        }
    }

    private static AffectedBooking toAffectedBooking(List<CourtAllocation> allocationsOfOneBooking) {
        CourtAllocation first = allocationsOfOneBooking.get(0);
        List<UUID> courtIds = allocationsOfOneBooking.stream().map(CourtAllocation::getCourtId).toList();
        return new AffectedBooking(
                first.getBooking().getId(), courtIds, first.getStartsAt(), first.getEndsAt());
    }
}
