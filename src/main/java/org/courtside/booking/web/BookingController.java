package org.courtside.booking.web;

import org.courtside.booking.BookingService;
import org.courtside.booking.CourtAllocation;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.internal.MatchType;
import org.courtside.booking.ParticipantSpec;
import org.courtside.booking.web.BookingWebModels.AllocationResponse;
import org.courtside.booking.web.BookingWebModels.BookingCreatedResponse;
import org.courtside.booking.web.BookingWebModels.CreateBookingRequest;
import org.courtside.card.BookingCard;
import org.courtside.card.CardService;
import org.courtside.identity.CurrentUser;
import org.courtside.identity.UserAccount;
import org.courtside.shared.TimeSlot;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/bookings")
class BookingController {

    private final BookingService bookings;
    private final CardService cards;
    private final CurrentUser currentUser;
    private final ZoneId zone;

    BookingController(BookingService bookings,
                      CardService cards,
                      CurrentUser currentUser,
                      @Value("${courtside.booking.time-zone}") String zone) {
        this.bookings = bookings;
        this.cards = cards;
        this.currentUser = currentUser;
        this.zone = ZoneId.of(zone);
    }

    @PostMapping
    ResponseEntity<BookingCreatedResponse> create(@Valid @RequestBody CreateBookingRequest request) {
        UserAccount account = currentUser.requireAccount();

        List<ParticipantSpec> participants = request.participants() == null
                ? List.of()
                : request.participants().stream()
                        .map(p -> ParticipantSpec.from(p.personId(), p.guestName(), p.cardId()))
                        .toList();

        UUID id = bookings.create(new CreateBookingCommand(
                request.courtIds(),
                request.cardId(),
                new TimeSlot(request.startsAt(), request.endsAt()),
                account.getId(),
                account.getPerson().getId(),
                account.getRoles(),
                request.note(),
                participants,
                null));

        return ResponseEntity.created(URI.create("/api/bookings/" + id))
                .body(new BookingCreatedResponse(id));
    }

    @DeleteMapping("/{id}")
    ResponseEntity<Void> cancel(@PathVariable UUID id) {
        UserAccount account = currentUser.requireAccount();
        bookings.cancel(id, account.getId(), account.getRoles());
        return ResponseEntity.noContent().build();
    }

    @GetMapping
    List<AllocationResponse> grid(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        List<CourtAllocation> allocations = bookings.allocationsBetween(
                date.atStartOfDay(zone).toInstant(),
                date.plusDays(1).atStartOfDay(zone).toInstant());

        Map<UUID, BookingCard> cardsById = cards.allCards().stream()
                .collect(Collectors.toMap(BookingCard::getId, card -> card));
        Map<UUID, Long> slotCounts = bookings.participantCountsFor(
                allocations.stream().map(a -> a.getBooking().getId()).distinct().toList());

        return allocations.stream()
                .map(allocation -> toResponse(allocation, cardsById, slotCounts))
                .toList();
    }

    private AllocationResponse toResponse(CourtAllocation allocation,
                                          Map<UUID, BookingCard> cardsById,
                                          Map<UUID, Long> slotCounts) {
        BookingCard card = cardsById.get(allocation.getBooking().getCardId());
        String matchType = MatchType
                .ofSlotCount(slotCounts.getOrDefault(allocation.getBooking().getId(), 0L))
                .map(Enum::name)
                .orElse(null);

        return new AllocationResponse(
                allocation.getBooking().getId(),
                allocation.getCourtId(),
                allocation.getStartsAt(),
                allocation.getEndsAt(),
                card == null ? "?" : card.getLabel(),
                card == null ? "#999999" : card.getColor(),
                null,
                matchType);
    }
}
