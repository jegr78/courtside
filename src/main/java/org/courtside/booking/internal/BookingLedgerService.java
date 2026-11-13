package org.courtside.booking.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.booking.BookingLedger;
import org.courtside.card.BookingCard;
import org.courtside.card.CardService;
import org.courtside.config.ClubTimeZone;
import org.courtside.facility.Court;
import org.courtside.facility.FacilityService;
import org.courtside.shared.DatabaseDeadlines;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Clock;
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
    private final JdbcClient jdbc;
    private final Clock clock;

    @Override
    @Transactional(readOnly = true, timeoutString = DatabaseDeadlines.REPORT)
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

    @Override
    @Transactional(readOnly = true, timeoutString = DatabaseDeadlines.REPORT)
    public GuestFeeLedger chargedGuestsBetween(LocalDate from, LocalDate to) {
        ReportingPeriod.validate(from, to);
        ZoneId zone = clubTimeZone.zoneId();
        List<ChargedGuests> charged = jdbc.sql("""
                        WITH held AS (
                            SELECT b.id, b.booked_by FROM booking b
                            JOIN court_allocation a ON a.booking_id = b.id
                            WHERE b.status = 'CONFIRMED'
                            GROUP BY b.id, b.booked_by
                            HAVING min(a.starts_at) >= :from AND min(a.starts_at) < :to AND max(a.ends_at) <= :now
                        )
                        SELECT u.person_id, p.guest_fee_currency, count(*) AS places, sum(p.guest_fee_minor) AS total
                        FROM held h
                        JOIN booking_participant p ON p.booking_id = h.id AND p.kind = 'GUEST' AND p.guest_fee_minor > 0
                        LEFT JOIN user_account u ON u.id = h.booked_by AND u.anonymised_at IS NULL
                        GROUP BY u.person_id, p.guest_fee_currency
                        """)
                .param("from", Timestamp.from(from.atStartOfDay(zone).toInstant()))
                .param("to", Timestamp.from(to.plusDays(1).atStartOfDay(zone).toInstant()))
                .param("now", Timestamp.from(clock.instant()))
                .query((row, number) -> new ChargedGuests(row.getObject("person_id", UUID.class),
                        row.getString("guest_fee_currency"), row.getInt("places"), row.getLong("total")))
                .list();
        int unassigned = charged.stream().filter(line -> line.personId() == null)
                .mapToInt(ChargedGuests::guestPlaces).sum();
        return new GuestFeeLedger(charged.stream().filter(line -> line.personId() != null).toList(), unassigned);
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
