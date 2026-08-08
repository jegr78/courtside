package org.courtside.booking.internal;

import org.courtside.booking.CourtAllocation;
import org.courtside.card.CardNotFoundException;
import org.courtside.card.CardService;
import org.courtside.facility.CourtNotFoundException;
import org.courtside.facility.FacilityService;
import org.courtside.shared.OpeningWindow;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
@Transactional(readOnly = true)
public class ImpactService {

    private static final int LISTED_AT_MOST = 50;

    private final CourtAllocationRepository allocations;
    private final FacilityService facility;
    private final CardService cards;
    private final Clock clock;
    private final ZoneId zone;

    public ImpactService(CourtAllocationRepository allocations, FacilityService facility,
                         CardService cards, Clock clock,
                         @Value("${courtside.booking.time-zone}") String zone) {
        this.allocations = allocations;
        this.facility = facility;
        this.cards = cards;
        this.clock = clock;
        this.zone = ZoneId.of(zone);
    }

    public record AffectedBooking(UUID bookingId, List<UUID> courtIds, Instant startsAt, Instant endsAt) {
    }

    public record Impact(int affectedCount, boolean truncated, List<AffectedBooking> bookings) {
    }

    public Impact ofDeactivating(UUID courtId) {
        facility.findCourt(courtId).orElseThrow(
                () -> new CourtNotFoundException("No court with id " + courtId));
        return impactOf(allocations.findConfirmedFutureByCourt(courtId, clock.instant()));
    }

    public Impact ofRetiringCard(UUID cardId) {
        cards.findCard(cardId).orElseThrow(
                () -> new CardNotFoundException("No booking card with id " + cardId));
        return impactOf(allocations.findConfirmedFutureByCard(cardId, clock.instant()));
    }

    public Impact ofClosingWeekday(DayOfWeek day) {
        return impactOf(confirmedFutureOn(day));
    }

    public Impact ofOpeningHours(DayOfWeek day, OpeningWindow window) {
        OpeningWindow required = OpeningWindow.required(window);
        return impactOf(confirmedFutureOn(day).stream()
                .filter(allocation -> !required.covers(localTime(allocation.getStartsAt()),
                        localTime(allocation.getEndsAt())))
                .toList());
    }

    private List<CourtAllocation> confirmedFutureOn(DayOfWeek day) {
        return allocations.findConfirmedFutureOnWeekday(clock.instant(), zone.getId(), day.getValue());
    }

    private LocalTime localTime(Instant instant) {
        return instant.atZone(zone).toLocalTime();
    }

    private Impact impactOf(List<CourtAllocation> affected) {
        Map<UUID, List<CourtAllocation>> allocationsByBooking = affected.stream()
                .collect(Collectors.groupingBy(
                        allocation -> allocation.getBooking().getId(),
                        LinkedHashMap::new,
                        Collectors.toList()));
        List<AffectedBooking> merged = allocationsByBooking.values().stream()
                .map(ImpactService::toAffectedBooking)
                .toList();
        List<AffectedBooking> listed = merged.stream().limit(LISTED_AT_MOST).toList();
        return new Impact(merged.size(), merged.size() > LISTED_AT_MOST, listed);
    }

    private static AffectedBooking toAffectedBooking(List<CourtAllocation> allocationsOfOneBooking) {
        CourtAllocation first = allocationsOfOneBooking.get(0);
        List<UUID> courtIds = allocationsOfOneBooking.stream().map(CourtAllocation::getCourtId).toList();
        return new AffectedBooking(
                first.getBooking().getId(), courtIds, first.getStartsAt(), first.getEndsAt());
    }
}
