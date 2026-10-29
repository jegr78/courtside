package org.courtside.booking.waitlist;

import lombok.RequiredArgsConstructor;
import org.courtside.card.BookingCard;
import org.courtside.card.CardService;
import org.courtside.config.BookingGridCoordination;
import org.courtside.facility.Court;
import org.courtside.facility.FacilityService;
import org.courtside.shared.BookingAnnouncement;
import org.courtside.shared.WaitlistAnnouncer;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

@Component
@RequiredArgsConstructor
class WaitlistAnnouncements implements WaitlistAnnouncer {

    private final WaitlistRows rows;
    private final FacilityService facility;
    private final CardService cards;
    private final Clock clock;
    private final WaitlistQueue queue;
    private final BookingGridCoordination grid;

    @Override
    @Transactional
    public void offerUndeliverable(UUID entryId, UUID accountId) {
        grid.lock();
        rows.find(entryId)
                .filter(entry -> entry.accountId().equals(accountId) && entry.state() == WaitlistState.OFFERED)
                .ifPresent(entry -> {
                    rows.close(entry.id(), WaitlistState.SKIPPED, clock.instant());
                    queue.offerFreeQueues(List.of(entry.courtId()), entry.slot());
                });
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<Offer> describeOffer(UUID entryId) {
        return rows.find(entryId).flatMap(entry -> offerOf(entry, courtsById(), labelsById()));
    }

    @Override
    @Transactional(readOnly = true)
    public Map<UUID, Offer> describeOffersOf(UUID accountId, Collection<UUID> entryIds) {
        if (accountId == null || entryIds.isEmpty()) {
            return Map.of();
        }
        List<WaitlistEntry> entries = rows.findOwn(accountId, Set.copyOf(entryIds));
        if (entries.isEmpty()) {
            return Map.of();
        }
        Map<UUID, Court> courts = courtsById();
        Map<UUID, String> labels = labelsById();
        return entries.stream()
                .flatMap(entry -> offerOf(entry, courts, labels).map(offer -> Map.entry(entry.id(), offer)).stream())
                .collect(Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue));
    }

    private Optional<Offer> offerOf(WaitlistEntry entry, Map<UUID, Court> courts, Map<UUID, String> labels) {
        Court court = courts.get(entry.courtId());
        if (entry.offerExpiresAt() == null || court == null) {
            return Optional.empty();
        }
        Instant now = clock.instant();
        BookingAnnouncement slot = new BookingAnnouncement(entry.accountId(), List.of(), entry.slot().start(),
                entry.slot().end(), List.of(new BookingAnnouncement.AnnouncedCourt(court.getNumber(), court.getName())),
                labels.getOrDefault(entry.cardId(), ""), false, null);
        boolean open = entry.state() == WaitlistState.OFFERED && entry.offerExpiresAt().isAfter(now);
        return Optional.of(new Offer(entry.accountId(), slot, entry.offerExpiresAt(), open));
    }

    private Map<UUID, Court> courtsById() {
        return facility.allCourts().stream().collect(Collectors.toMap(Court::getId, Function.identity()));
    }

    private Map<UUID, String> labelsById() {
        return cards.allCards().stream().collect(Collectors.toMap(BookingCard::getId, BookingCard::getLabel));
    }
}
