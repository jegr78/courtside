package org.courtside.booking.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.booking.Booking;
import org.courtside.booking.BookingRepository;
import org.courtside.booking.BookingStatus;
import org.courtside.booking.BookingParticipant;
import org.courtside.booking.CourtAllocation;
import org.courtside.card.BookingCard;
import org.courtside.card.CardService;
import org.courtside.facility.Court;
import org.courtside.facility.FacilityService;
import org.courtside.shared.BookingAnnouncement;
import org.courtside.shared.BookingAnnouncer;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

@Component
@RequiredArgsConstructor
class BookingAnnouncements implements BookingAnnouncer {

    private final BookingRepository bookings;
    private final FacilityService facility;
    private final CardService cards;

    @Override
    @Transactional(readOnly = true)
    public Optional<BookingAnnouncement> describe(UUID bookingId) {
        return bookings.findWithAllocationsById(bookingId)
                .flatMap(booking -> announcementOf(booking, playersOf(bookingId),
                        courtId -> announcedCourt(facility.requireCourt(courtId)),
                        cardId -> cards.requireCard(cardId).getLabel()));
    }

    @Override
    @Transactional(readOnly = true)
    public Map<UUID, BookingAnnouncement> describeVisibleTo(UUID accountId, UUID personId,
                                                            Collection<UUID> bookingIds) {
        if (accountId == null || bookingIds.isEmpty()) {
            return Map.of();
        }
        Set<UUID> distinct = Set.copyOf(bookingIds);
        Map<UUID, List<UUID>> players = new HashMap<>();
        bookings.findMemberParticipantIdsByBooking(distinct).forEach(row ->
                players.computeIfAbsent((UUID) row[0], ignored -> new ArrayList<>()).add((UUID) row[1]));
        Map<UUID, BookingAnnouncement.AnnouncedCourt> courts = facility.allCourts().stream()
                .collect(Collectors.toMap(Court::getId, BookingAnnouncements::announcedCourt, (one, other) -> one,
                        HashMap::new));
        Map<UUID, String> cardLabels = cards.allCards().stream()
                .collect(Collectors.toMap(BookingCard::getId, BookingCard::getLabel, (one, other) -> one,
                        HashMap::new));
        Map<UUID, BookingAnnouncement> described = new HashMap<>();
        for (Booking booking : bookings.findAllByIdIn(distinct)) {
            List<UUID> playing = players.getOrDefault(booking.getId(), List.of());
            if (visibleTo(booking, playing, accountId, personId)) {
                announcementOf(booking, playing,
                        courtId -> courts.computeIfAbsent(courtId,
                                missing -> announcedCourt(facility.requireCourt(missing))),
                        cardId -> cardLabels.computeIfAbsent(cardId, missing -> cards.requireCard(missing).getLabel()))
                        .ifPresent(announcement -> described.put(booking.getId(), announcement));
            }
        }
        return described;
    }

    private static boolean visibleTo(Booking booking, List<UUID> players, UUID accountId, UUID personId) {
        return accountId.equals(booking.getBookedBy()) || personId != null && players.contains(personId);
    }

    private List<UUID> playersOf(UUID bookingId) {
        return bookings.findWithParticipantsById(bookingId)
                .map(booking -> booking.getParticipants().stream()
                        .map(BookingParticipant::getPersonId)
                        .filter(Objects::nonNull)
                        .toList())
                .orElseGet(List::of);
    }

    private static Optional<BookingAnnouncement> announcementOf(Booking booking, List<UUID> players,
                                                                Function<UUID, BookingAnnouncement.AnnouncedCourt> courtOf,
                                                                Function<UUID, String> cardLabelOf) {
        List<CourtAllocation> allocations = booking.getAllocations();
        if (allocations.isEmpty() || booking.getBookedBy() == null) {
            return Optional.empty();
        }
        return Optional.of(new BookingAnnouncement(
                booking.getBookedBy(),
                players,
                allocations.stream().map(CourtAllocation::getStartsAt).min(Comparator.naturalOrder()).orElseThrow(),
                allocations.stream().map(CourtAllocation::getEndsAt).max(Comparator.naturalOrder()).orElseThrow(),
                allocations.stream().map(allocation -> courtOf.apply(allocation.getCourtId())).toList(),
                cardLabelOf.apply(booking.getCardId()),
                booking.getStatus() == BookingStatus.CANCELLED));
    }

    private static BookingAnnouncement.AnnouncedCourt announcedCourt(Court court) {
        return new BookingAnnouncement.AnnouncedCourt(court.getNumber(), court.getName());
    }
}
