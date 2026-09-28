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
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
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

    record ImpactPage(UUID nextCursor, List<AffectedBooking> bookings) {
    }

    public Impact ofDeactivating(UUID courtId, UUID cursor, int limit) {
        return ofDeactivating(courtId, clock.instant(), cursor, limit);
    }

    // The caller pins the instant when it walks every page: reading the clock again per page lets a
    // booking that starts in between drop out of the cursor's own comparison, and the walk ends there.
    Impact ofDeactivating(UUID courtId, Instant from, UUID cursor, int limit) {
        return impactOf(deactivatingBookingIds(courtId, from, cursor, limit),
                allocations.countImpactBookingsByCourt(courtId, from), limit);
    }

    ImpactPage pageOfDeactivating(UUID courtId, Instant from, UUID cursor, int limit) {
        return pageOf(deactivatingBookingIds(courtId, from, cursor, limit), limit);
    }

    public Impact ofRetiringCard(UUID cardId, UUID cursor, int limit) {
        return ofRetiringCard(cardId, clock.instant(), cursor, limit);
    }

    Impact ofRetiringCard(UUID cardId, Instant from, UUID cursor, int limit) {
        return impactOf(retiringCardBookingIds(cardId, from, cursor, limit),
                allocations.countImpactBookingsByCard(cardId, from), limit);
    }

    ImpactPage pageOfRetiringCard(UUID cardId, Instant from, UUID cursor, int limit) {
        return pageOf(retiringCardBookingIds(cardId, from, cursor, limit), limit);
    }

    /** Bookings the week starting on {@code effectiveFrom}, today when null, would leave closed on {@code day}. */
    public Impact ofClosingWeekday(DayOfWeek day, LocalDate effectiveFrom, UUID cursor, int limit) {
        Period period = scheduledPeriod(effectiveFrom);
        return openingHoursImpact(day, true, LocalTime.MIN, LocalTime.MAX, period, cursor, limit);
    }

    ImpactPage pageOfClosingWeekday(DayOfWeek day, Period period, UUID cursor, int limit) {
        return openingHoursPage(day, true, LocalTime.MIN, LocalTime.MAX, period, cursor, limit);
    }

    /** Bookings a window starting on {@code effectiveFrom}, today when null, would no longer cover. */
    public Impact ofOpeningHours(DayOfWeek day, OpeningWindow window, LocalDate effectiveFrom,
                                 UUID cursor, int limit) {
        OpeningWindow required = OpeningWindow.required(window);
        Period period = scheduledPeriod(effectiveFrom);
        return openingHoursImpact(day, false, required.opensAt(), required.closesAt(), period, cursor, limit);
    }

    ImpactPage pageOfOpeningHours(DayOfWeek day, OpeningWindow window, Period period, UUID cursor, int limit) {
        OpeningWindow required = OpeningWindow.required(window);
        return openingHoursPage(day, false, required.opensAt(), required.closesAt(), period, cursor, limit);
    }

    /** The instants from {@code from} up to {@code until} over which one version of the hours governs. */
    record Period(Instant from, Instant until) {

        private static final Instant OPEN_END = Instant.parse("9999-12-31T00:00:00Z");

        static Period of(Instant now, LocalDate effectiveFrom, LocalDate until, ZoneId zone) {
            Instant start = effectiveFrom == null ? now : effectiveFrom.atStartOfDay(zone).toInstant();
            Instant end = until == null ? OPEN_END : until.atStartOfDay(zone).toInstant();
            Instant from = start.isAfter(now) ? start : now;
            // A start beyond the open end governs nothing, and PostgreSQL cannot hold every Java date.
            return new Period(from.isAfter(end) ? end : from, end);
        }
    }

    private Period scheduledPeriod(LocalDate effectiveFrom) {
        LocalDate start = effectiveFrom == null ? facility.today() : effectiveFrom;
        return Period.of(clock.instant(), start,
                facility.openingSchedule().nextChangeAfter(start).orElse(null), timeZone.zoneId());
    }

    private Impact openingHoursImpact(DayOfWeek day, boolean closed, LocalTime opensAt, LocalTime closesAt,
                                      Period period, UUID cursor, int limit) {
        List<UUID> bookingIds = openingHoursBookingIds(
                day, closed, opensAt, closesAt, period, cursor, limit);
        long affectedCount = allocations.countImpactBookingsByOpeningHours(
                period.from(), period.until(), timeZone.id(), day.getValue(), closed, opensAt, closesAt);
        return impactOf(bookingIds, affectedCount, limit);
    }

    private ImpactPage openingHoursPage(DayOfWeek day, boolean closed, LocalTime opensAt,
                                        LocalTime closesAt, Period period, UUID cursor, int limit) {
        return pageOf(openingHoursBookingIds(day, closed, opensAt, closesAt, period, cursor, limit), limit);
    }

    private List<UUID> deactivatingBookingIds(UUID courtId, Instant from, UUID cursor, int limit) {
        validateLimit(limit);
        facility.findCourt(courtId).orElseThrow(
                () -> new CourtNotFoundException("No court with id " + courtId));
        return allocations.findImpactBookingIdsByCourt(
                courtId, from, cursor == null, cursorOrFirstPage(cursor), page(limit));
    }

    private List<UUID> retiringCardBookingIds(UUID cardId, Instant from, UUID cursor, int limit) {
        validateLimit(limit);
        cards.findCard(cardId).orElseThrow(
                () -> new CardNotFoundException("No booking card with id " + cardId));
        return allocations.findImpactBookingIdsByCard(
                cardId, from, cursor == null, cursorOrFirstPage(cursor), page(limit));
    }

    private List<UUID> openingHoursBookingIds(DayOfWeek day, boolean closed, LocalTime opensAt,
                                              LocalTime closesAt, Period period, UUID cursor, int limit) {
        validateLimit(limit);
        return allocations.findImpactBookingIdsByOpeningHours(
                period.from(), period.until(), timeZone.id(), day.getValue(), closed, opensAt, closesAt,
                cursor == null, cursorOrFirstPage(cursor), page(limit));
    }

    private Impact impactOf(List<UUID> bookingIds, long affectedCount, int limit) {
        ImpactPage page = pageOf(bookingIds, limit);
        return new Impact(Math.toIntExact(affectedCount), page.nextCursor() != null,
                page.nextCursor(), page.bookings());
    }

    private ImpactPage pageOf(List<UUID> bookingIds, int limit) {
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
        return new ImpactPage(nextCursor, listed);
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
