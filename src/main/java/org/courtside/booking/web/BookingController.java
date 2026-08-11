package org.courtside.booking.web;

import org.courtside.api.ApiAllocation;
import org.courtside.api.ApiBookingCreated;
import org.courtside.api.ApiCreateBookingRequest;
import org.courtside.api.ApiMatchType;
import org.courtside.api.ApiBookingStatus;
import org.courtside.api.ApiPersonalBooking;
import org.courtside.api.ApiPersonalBookingPage;
import org.courtside.api.BookingsApi;
import org.courtside.booking.BookingService;
import org.courtside.booking.CourtAllocation;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.internal.MatchType;
import org.courtside.booking.ParticipantSpec;
import org.courtside.booking.PersonalBookingPage;
import org.courtside.card.BookingCard;
import org.courtside.card.CardService;
import org.courtside.identity.CurrentUser;
import org.courtside.identity.UserAccount;
import org.courtside.shared.TimeSlot;
import org.courtside.shared.WireTypes;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.WebDataBinder;
import org.springframework.web.bind.annotation.InitBinder;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

@RestController
class BookingController implements BookingsApi {

    private final BookingService bookings;
    private final CardService cards;
    private final CurrentUser currentUser;
    private final BookingRequestValidator crossFieldRules;
    private final ZoneId zone;

    BookingController(BookingService bookings,
                      CardService cards,
                      CurrentUser currentUser,
                      BookingRequestValidator crossFieldRules,
                      @Value("${courtside.booking.time-zone}") String zone) {
        this.bookings = bookings;
        this.cards = cards;
        this.currentUser = currentUser;
        this.crossFieldRules = crossFieldRules;
        this.zone = ZoneId.of(zone);
    }

    @InitBinder
    void registerCrossFieldRules(WebDataBinder binder) {
        binder.addValidators(crossFieldRules);
    }

    @Override
    public ResponseEntity<ApiBookingCreated> createBooking(String idempotencyKey,
                                                           ApiCreateBookingRequest request) {
        UserAccount account = currentUser.requireAccount();

        List<ParticipantSpec> participants = request.getParticipants() == null
                ? List.of()
                : request.getParticipants().stream()
                        .map(p -> ParticipantSpec.from(p.getPersonId(), p.getGuestName(), p.getCardId()))
                        .toList();

        UUID id = bookings.create(new CreateBookingCommand(
                List.copyOf(request.getCourtIds()),
                request.getCardId(),
                new TimeSlot(WireTypes.toInstant(request.getStartsAt()),
                        WireTypes.toInstant(request.getEndsAt())),
                account.getId(),
                account.getPerson().getId(),
                account.getRoles(),
                request.getNote(),
                participants,
                null), idempotencyKey);

        return ResponseEntity.created(URI.create("/api/bookings/" + id))
                .body(new ApiBookingCreated(id));
    }

    @Override
    public ResponseEntity<Void> cancelBooking(UUID id) {
        UserAccount account = currentUser.requireAccount();
        bookings.cancel(id, account.getId(), account.getRoles());
        return ResponseEntity.noContent().build();
    }

    @Override
    public ResponseEntity<ApiPersonalBookingPage> listPersonalBookings(UUID cursor, Integer limit) {
        UserAccount account = currentUser.requireAccount();
        Map<UUID, BookingCard> cardsById = cards.allCards().stream()
                .collect(Collectors.toMap(BookingCard::getId, card -> card));
        PersonalBookingPage page = bookings.personalBookings(account.getId(), cursor, limit);
        List<ApiPersonalBooking> items = page.bookings().stream()
                .map(booking -> {
                    List<CourtAllocation> allocations = booking.getAllocations();
                    CourtAllocation first = allocations.getFirst();
                    BookingCard card = cardsById.get(booking.getCardId());
                    return new ApiPersonalBooking(
                            booking.getId(),
                            allocations.stream().map(CourtAllocation::getCourtId).toList(),
                            WireTypes.toOffsetDateTime(first.getStartsAt()),
                            WireTypes.toOffsetDateTime(first.getEndsAt()),
                            card == null ? "?" : card.getLabel(),
                            card == null ? "#999999" : card.getColor(),
                            ApiBookingStatus.fromValue(booking.getStatus().name()))
                            .seriesId(booking.getSeriesId())
                            .note(booking.getNote());
                })
                .toList();
        return ResponseEntity.ok(new ApiPersonalBookingPage(items).nextCursor(page.nextCursor()));
    }

    @Override
    public ResponseEntity<List<ApiAllocation>> listAllocations(LocalDate date) {
        List<CourtAllocation> allocations = bookings.allocationsBetween(
                date.atStartOfDay(zone).toInstant(),
                date.plusDays(1).atStartOfDay(zone).toInstant());

        Map<UUID, BookingCard> cardsById = cards.allCards().stream()
                .collect(Collectors.toMap(BookingCard::getId, card -> card));
        Map<UUID, Long> slotCounts = bookings.participantCountsFor(
                allocations.stream().map(a -> a.getBooking().getId()).distinct().toList());

        return ResponseEntity.ok(allocations.stream()
                .map(allocation -> toResponse(allocation, cardsById, slotCounts))
                .toList());
    }

    private ApiAllocation toResponse(CourtAllocation allocation,
                                     Map<UUID, BookingCard> cardsById,
                                     Map<UUID, Long> slotCounts) {
        BookingCard card = cardsById.get(allocation.getBooking().getCardId());
        ApiMatchType matchType = MatchType
                .ofSlotCount(slotCounts.getOrDefault(allocation.getBooking().getId(), 0L))
                .map(type -> ApiMatchType.fromValue(type.name()))
                .orElse(null);

        return new ApiAllocation(
                allocation.getBooking().getId(),
                allocation.getCourtId(),
                WireTypes.toOffsetDateTime(allocation.getStartsAt()),
                WireTypes.toOffsetDateTime(allocation.getEndsAt()),
                card == null ? "?" : card.getLabel(),
                card == null ? "#999999" : card.getColor())
                .matchType(matchType);
    }
}
