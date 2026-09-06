package org.courtside.booking.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.booking.BookingLedger;
import org.courtside.card.BookingCard;
import org.courtside.card.CardService;
import org.courtside.config.ClubTimeZone;
import org.courtside.facility.Court;
import org.courtside.facility.FacilityService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
class BookingLedgerService implements BookingLedger {

    private final CourtAllocationRepository allocations;
    private final FacilityService facility;
    private final CardService cards;
    private final ClubTimeZone clubTimeZone;

    @Override
    public List<Occupancy> confirmedBetween(LocalDate from, LocalDate to) {
        ReportingPeriod.validate(from, to);
        ZoneId zone = clubTimeZone.zoneId();
        Instant startsAt = from.atStartOfDay(zone).toInstant();
        Instant endsAt = to.plusDays(1).atStartOfDay(zone).toInstant();
        Map<UUID, Court> courts = facility.allCourts().stream()
                .collect(Collectors.toMap(Court::getId, Function.identity()));
        Map<UUID, String> labels = cards.allCards().stream()
                .collect(Collectors.toMap(BookingCard::getId, BookingCard::getLabel));
        return allocations.findConfirmedStartingBetween(startsAt, endsAt).stream()
                .map(allocation -> occupancy(allocation, zone, courts, labels))
                .toList();
    }

    private static Occupancy occupancy(org.courtside.booking.CourtAllocation allocation, ZoneId zone,
                                       Map<UUID, Court> courts, Map<UUID, String> labels) {
        ZonedDateTime starts = allocation.getStartsAt().atZone(zone);
        Court court = courts.get(allocation.getCourtId());
        return new Occupancy(starts.toLocalDate(), starts.toLocalTime(),
                allocation.getEndsAt().atZone(zone).toLocalTime(),
                court == null ? 0 : court.getNumber(), court == null ? "" : court.getName(),
                labels.getOrDefault(allocation.getBooking().getCardId(), ""));
    }
}
