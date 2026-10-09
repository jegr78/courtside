package org.courtside.booking.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.card.BookingCard;
import org.courtside.card.CardService;
import org.courtside.config.BookingGridSettings;
import org.courtside.config.ClubTimeZone;
import org.courtside.facility.Court;
import org.courtside.facility.FacilityService;
import org.courtside.facility.OpeningSchedule;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Component
@RequiredArgsConstructor
class WarmUpTarget {

    static final UUID BOOKER = new UUID(0, 0);

    private static final int DAYS_SEARCHED = 28;

    private final FacilityService facility;
    private final CardService cards;
    private final BookingGridSettings grid;
    private final ClubTimeZone timeZone;
    private final CourtAllocationRepository allocations;

    /** The first free slot of an opening window at least {@code daysAhead} days from today. */
    Optional<Target> find(int daysAhead) {
        Optional<UUID> court = facility.activeCourts().stream().map(Court::getId).findFirst();
        Optional<UUID> card = cards.activeCards().stream()
                .filter(candidate -> !candidate.tracksPlayers())
                .map(BookingCard::getId)
                .findFirst();
        if (court.isEmpty() || card.isEmpty()) {
            return Optional.empty();
        }
        OpeningSchedule schedule = facility.openingSchedule();
        LocalDate first = facility.today().plusDays(daysAhead);
        int minutes = grid.slotMinutes();
        for (int day = 0; day < DAYS_SEARCHED; day++) {
            LocalDate date = first.plusDays(day);
            Optional<OpeningWindow> window = schedule.windowOn(date);
            if (window.isEmpty() || !window.get().covers(window.get().opensAt(),
                    window.get().opensAt().plusMinutes(minutes))) {
                continue;
            }
            LocalTime opensAt = window.get().opensAt();
            Instant start = date.atTime(opensAt).atZone(timeZone.zoneId()).toInstant();
            Instant end = start.plusSeconds(minutes * 60L);
            if (!allocations.existsConfirmedOverlapping(List.of(court.get()), start, end)) {
                return Optional.of(new Target(court.get(), card.get(), date, opensAt, minutes,
                        new TimeSlot(start, end)));
            }
        }
        return Optional.empty();
    }

    record Target(UUID courtId, UUID cardId, LocalDate date, LocalTime startTime, int minutes, TimeSlot slot) {
    }
}
