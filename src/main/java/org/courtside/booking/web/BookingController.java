package org.courtside.booking.web;

import org.courtside.api.ApiCancellationReason;
import org.courtside.api.ApiAllocation;
import org.courtside.api.ApiBookingCreated;
import org.courtside.api.ApiBookingEligibility;
import org.courtside.api.ApiBookingHours;
import org.courtside.api.ApiViolation;
import org.courtside.api.ApiCreateBookingRequest;
import org.courtside.api.ApiBookingStatus;
import org.courtside.api.ApiParticipationPage;
import org.courtside.api.ApiPersonalBookingPage;
import org.courtside.api.ApiPersonalBookingView;
import org.courtside.api.ApiManagedAppointment;
import org.courtside.api.ApiAttendanceOutcome;
import org.courtside.api.ApiManagedAppointmentDetail;
import org.courtside.api.ApiManagedAppointmentPage;
import org.courtside.api.ApiManagedAppointmentView;
import org.courtside.api.ApiManagedParticipant;
import org.courtside.api.ApiManagedParticipantKind;
import org.courtside.api.ApiManagedSeriesFacts;
import org.courtside.api.BookingsApi;
import org.courtside.booking.BookingService;
import org.courtside.booking.CourtAllocation;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.ParticipantSpec;
import org.courtside.booking.ParticipationPage;
import org.courtside.booking.ParticipationService;
import org.courtside.booking.PersonalBookingPage;
import org.courtside.booking.PersonalBookingView;
import org.courtside.booking.Booking;
import org.courtside.booking.BookingStatus;
import org.courtside.booking.attendance.AttendanceService;
import org.courtside.booking.internal.AllocationVisibilityService;
import org.courtside.booking.internal.BookingRuleGate;
import org.courtside.booking.internal.ManagedAppointmentQuery;
import org.courtside.booking.internal.AllocationVisibilityService.AllocationVisibility;
import org.courtside.card.BookingCard;
import org.courtside.card.CardService;
import org.courtside.config.ClubTimeZone;
import org.courtside.facility.FacilityService;
import org.courtside.identity.CurrentUser;
import org.courtside.identity.UserAccount;
import org.courtside.shared.TimeSlot;
import org.courtside.shared.WireTypes;
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

    private static final String GENERIC_CARD_LABEL = "?";
    private static final String GENERIC_CARD_COLOR = "#999999";

    private final BookingService bookings;
    private final CardService cards;
    private final CurrentUser currentUser;
    private final AllocationVisibilityService allocationVisibility;
    private final BookingRequestValidator crossFieldRules;
    private final ManagedAppointmentQuery managedAppointments;
    private final ClubTimeZone timeZone;
    private final ParticipationService participations;
    private final BookingRuleGate ruleGate;
    private final FacilityService facility;
    private final AttendanceService attendance;
    private final PersonalBookingPages personalBookingPages;

    BookingController(BookingService bookings,
                      CardService cards,
                      CurrentUser currentUser,
                      AllocationVisibilityService allocationVisibility,
                      BookingRequestValidator crossFieldRules,
                      ManagedAppointmentQuery managedAppointments,
                      ClubTimeZone timeZone,
                      ParticipationService participations,
                      BookingRuleGate ruleGate,
                      FacilityService facility,
                      AttendanceService attendance,
                      PersonalBookingPages personalBookingPages) {
        this.bookings = bookings;
        this.cards = cards;
        this.currentUser = currentUser;
        this.allocationVisibility = allocationVisibility;
        this.crossFieldRules = crossFieldRules;
        this.managedAppointments = managedAppointments;
        this.timeZone = timeZone;
        this.participations = participations;
        this.ruleGate = ruleGate;
        this.facility = facility;
        this.attendance = attendance;
        this.personalBookingPages = personalBookingPages;
    }

    @Override
    public ResponseEntity<ApiBookingEligibility> getBookingEligibility() {
        UserAccount account = currentUser.requireAccount();
        List<ApiViolation> violations = ruleGate.bookingEligibilityFor(
                        personIdOf(account), account.getRoles()).stream()
                .map(violation -> new ApiViolation(violation.code(), violation.params()))
                .toList();
        return ResponseEntity.ok(new ApiBookingEligibility(violations)
                .maxBookingMinutes(ruleGate.maxBookingMinutesFor(
                        personIdOf(account), account.getRoles()))
                .minBookingMinutes(ruleGate.minBookingMinutesFor(personIdOf(account), account.getRoles()))
                .maxWeeklyBookedHours(ruleGate.maxWeeklyBookedHoursFor(personIdOf(account), account.getRoles()))
                .bookingHours(ruleGate.bookingWindowFor(personIdOf(account), account.getRoles())
                        .map(window -> new ApiBookingHours(window.earliestStart(), window.latestEnd()))
                        .orElse(null)));
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
    public ResponseEntity<Void> cancelBooking(UUID id, ApiCancellationReason reason) {
        UserAccount account = currentUser.requireAccount();
        bookings.cancel(id, account.getId(), account.getRoles(), ApiCancellationReasons.of(reason));
        return ResponseEntity.noContent().build();
    }

    @Override
    public ResponseEntity<ApiPersonalBookingPage> listPersonalBookings(
            ApiPersonalBookingView view, UUID cursor, Integer limit) {
        UserAccount account = currentUser.requireAccount();
        PersonalBookingPage page = bookings.personalBookings(
                account.getId(), PersonalBookingView.valueOf(view.getValue()), cursor, limit);
        return ResponseEntity.ok(personalBookingPages.render(page, view));
    }

    @Override
    public ResponseEntity<ApiParticipationPage> listOwnParticipations(UUID cursor, Integer limit) {
        UserAccount account = currentUser.requireAccount();
        ParticipationPage page = participations.participations(
                personIdOf(account), account.getId(), cursor, limit);
        return ResponseEntity.ok(personalBookingPages.renderParticipations(page));
    }

    @Override
    public ResponseEntity<Void> removeOwnParticipation(UUID bookingId) {
        UserAccount account = currentUser.requireAccount();
        participations.withdraw(bookingId, personIdOf(account), account.getId());
        return ResponseEntity.noContent().build();
    }

    private static UUID personIdOf(UserAccount account) {
        return account.getPerson() == null ? null : account.getPerson().getId();
    }

    @Override
    public ResponseEntity<ApiManagedAppointmentPage> listManagedAppointments(
            ApiManagedAppointmentView view, UUID courtId, UUID cardId, UUID cursor, Integer limit) {
        UserAccount account = currentUser.requireAccount();
        ManagedAppointmentQuery.Page page = managedAppointments.list(account.getRoles(),
                ManagedAppointmentQuery.View.valueOf(view.getValue()), courtId, cardId, cursor, limit);
        Map<UUID, BookingCard> cardsById = cards.allCards().stream()
                .collect(Collectors.toMap(BookingCard::getId, card -> card));
        Map<UUID, Long> participantCounts = bookings.participantCountsFor(
                page.bookings().stream().map(Booking::getId).toList());
        List<ApiManagedAppointment> items = page.bookings().stream()
                .map(booking -> toManagedAppointment(booking, cardsById,
                        participantCounts.getOrDefault(booking.getId(), 0L), account.getId()))
                .toList();
        List<ApiManagedSeriesFacts> series = page.series().stream()
                .map(facts -> new ApiManagedSeriesFacts(facts.seriesId(),
                        WireTypes.toOffsetDateTime(facts.firstStartsAt()),
                        WireTypes.toOffsetDateTime(facts.lastStartsAt()),
                        Math.toIntExact(facts.occurrences()), Math.toIntExact(facts.cancelled()),
                        Math.toIntExact(facts.past())))
                .toList();
        return ResponseEntity.ok(new ApiManagedAppointmentPage(items, series).nextCursor(page.nextCursor()));
    }

    @Override
    public ResponseEntity<ApiManagedAppointmentDetail> getManagedAppointment(UUID id) {
        UserAccount account = currentUser.requireAccount();
        ManagedAppointmentQuery.Detail detail = managedAppointments.get(
                id, account.getId(), account.getRoles());
        Booking booking = detail.booking();
        CourtAllocation allocation = booking.getAllocations().getFirst();
        BookingCard card = detail.card();
        List<ApiManagedParticipant> participants = detail.participants().stream()
                .map(this::toManagedParticipant)
                .toList();
        return ResponseEntity.ok(new ApiManagedAppointmentDetail(
                booking.getId(), booking.getCardId(),
                booking.getAllocations().stream().map(CourtAllocation::getCourtId).toList(),
                WireTypes.toOffsetDateTime(allocation.getStartsAt()),
                WireTypes.toOffsetDateTime(allocation.getEndsAt()), card.getLabel(), card.getColor(),
                ApiBookingStatus.fromValue(booking.getStatus().name()), participants.size(),
                account.getId().equals(booking.getBookedBy()), participants)
                .seriesId(booking.getSeriesId())
                .note(booking.getNote())
                .attendance(attendance.outcomeOf(booking.getId())
                        .map(outcome -> ApiAttendanceOutcome.fromValue(outcome.name()))
                        .orElse(null)));
    }

    private ApiManagedAppointment toManagedAppointment(Booking booking,
                                                        Map<UUID, BookingCard> cardsById,
                                                        long participantCount, UUID callerAccountId) {
        CourtAllocation allocation = booking.getAllocations().getFirst();
        BookingCard card = cardsById.get(booking.getCardId());
        if (card == null) {
            throw new IllegalStateException("A booking references an unknown card");
        }
        return new ApiManagedAppointment(
                booking.getId(), booking.getCardId(),
                booking.getAllocations().stream().map(CourtAllocation::getCourtId).toList(),
                WireTypes.toOffsetDateTime(allocation.getStartsAt()),
                WireTypes.toOffsetDateTime(allocation.getEndsAt()), card.getLabel(), card.getColor(),
                ApiBookingStatus.fromValue(booking.getStatus().name()), Math.toIntExact(participantCount),
                callerAccountId.equals(booking.getBookedBy()))
                .seriesId(booking.getSeriesId());
    }

    private ApiManagedParticipant toManagedParticipant(ManagedAppointmentQuery.Participant participant) {
        return new ApiManagedParticipant(
                ApiManagedParticipantKind.fromValue(participant.kind()), participant.displayName());
    }

    @Override
    public ResponseEntity<List<ApiAllocation>> listAllocations(LocalDate date, LocalDate from, LocalDate to) {
        ZoneId zone = timeZone.zoneId();
        DayRange days = DayRange.of(date, from, to);
        List<CourtAllocation> allocations = bookings.allocationsBetween(days.start(zone), days.end(zone));

        Map<UUID, BookingCard> cardsById = cards.allCards().stream()
                .collect(Collectors.toMap(BookingCard::getId, card -> card));
        Map<UUID, Long> slotCounts = bookings.participantCountsFor(
                allocations.stream().map(a -> a.getBooking().getId()).distinct().toList());
        Map<UUID, AllocationVisibility> visibility = allocationVisibility.resolve(
                allocations, currentUser.accountReadyForUse());

        return ResponseEntity.ok(allocations.stream()
                .map(allocation -> toResponse(allocation, cardsById, slotCounts, visibility))
                .toList());
    }

    private ApiAllocation toResponse(CourtAllocation allocation,
                                     Map<UUID, BookingCard> cardsById,
                                     Map<UUID, Long> slotCounts,
                                     Map<UUID, AllocationVisibility> visibility) {
        BookingCard card = cardsById.get(allocation.getBooking().getCardId());
        AllocationVisibility allocationVisibility = visibility.get(allocation.getBooking().getId());
        long slotCount = slotCounts.getOrDefault(allocation.getBooking().getId(), 0L);
        boolean showGenericOccupancy = card != null && card.isShowGenericOccupancy();
        boolean hideCard = showGenericOccupancy && !allocationVisibility.ownBooking();
        Integer participantCount = showGenericOccupancy && slotCount > 0
                ? Math.toIntExact(slotCount)
                : null;

        return new ApiAllocation(
                allocation.getBooking().getId(),
                allocation.getCourtId(),
                WireTypes.toOffsetDateTime(allocation.getStartsAt()),
                WireTypes.toOffsetDateTime(allocation.getEndsAt()),
                card == null || hideCard ? GENERIC_CARD_LABEL : card.getLabel(),
                card == null || hideCard ? GENERIC_CARD_COLOR : card.getColor(),
                allocationVisibility.ownBooking(), showGenericOccupancy)
                .participantLastNames(slotCount > 0 && allocationVisibility.ownBooking()
                        ? allocationVisibility.participantLastNames()
                        : null)
                .participantCount(participantCount);
    }
}
