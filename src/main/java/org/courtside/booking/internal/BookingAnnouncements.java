package org.courtside.booking.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.booking.Booking;
import org.courtside.booking.BookingRepository;
import org.courtside.booking.BookingParticipant;
import org.courtside.booking.CourtAllocation;
import org.courtside.card.CardService;
import org.courtside.facility.Court;
import org.courtside.facility.FacilityService;
import org.courtside.shared.BookingAnnouncement;
import org.courtside.shared.BookingAnnouncer;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.Comparator;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

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
                .flatMap(booking -> announcementOf(booking, playersOf(bookingId)));
    }

    private List<UUID> playersOf(UUID bookingId) {
        return bookings.findWithParticipantsById(bookingId)
                .map(booking -> booking.getParticipants().stream()
                        .map(BookingParticipant::getPersonId)
                        .filter(Objects::nonNull)
                        .toList())
                .orElseGet(List::of);
    }

    private Optional<BookingAnnouncement> announcementOf(Booking booking, List<UUID> players) {
        List<CourtAllocation> allocations = booking.getAllocations();
        if (allocations.isEmpty() || booking.getBookedBy() == null) {
            return Optional.empty();
        }
        return Optional.of(new BookingAnnouncement(
                booking.getBookedBy(),
                players,
                allocations.stream().map(CourtAllocation::getStartsAt).min(Comparator.naturalOrder()).orElseThrow(),
                allocations.stream().map(CourtAllocation::getEndsAt).max(Comparator.naturalOrder()).orElseThrow(),
                allocations.stream().map(allocation -> courtOf(allocation.getCourtId())).toList(),
                cards.requireCard(booking.getCardId()).getLabel()));
    }

    private BookingAnnouncement.AnnouncedCourt courtOf(UUID courtId) {
        Court court = facility.requireCourt(courtId);
        return new BookingAnnouncement.AnnouncedCourt(court.getNumber(), court.getName());
    }
}
