package org.courtside.booking.web;

import lombok.RequiredArgsConstructor;
import org.courtside.api.ApiBookingCreated;
import org.courtside.api.ApiJoinWaitlistRequest;
import org.courtside.api.ApiReservedSlot;
import org.courtside.api.ApiWaitlistEntry;
import org.courtside.api.ApiWaitlistEntryState;
import org.courtside.api.ApiWaitlistJoined;
import org.courtside.api.WaitlistApi;
import org.courtside.booking.ParticipantSpec;
import org.courtside.booking.waitlist.JoinWaitlistCommand;
import org.courtside.booking.waitlist.WaitlistService;
import org.courtside.card.BookingCard;
import org.courtside.card.CardService;
import org.courtside.config.ClubTimeZone;
import org.courtside.identity.CurrentUser;
import org.courtside.identity.UserAccount;
import org.courtside.shared.TimeSlot;
import org.courtside.shared.WireTypes;
import org.springframework.http.HttpStatus;
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
@RequiredArgsConstructor
class WaitlistController implements WaitlistApi {

    private final WaitlistService waitlist;
    private final CurrentUser currentUser;
    private final CardService cards;
    private final ClubTimeZone timeZone;
    private final WaitlistRequestValidator crossFieldRules;

    @InitBinder("apiJoinWaitlistRequest")
    void registerCrossFieldRules(WebDataBinder binder) {
        binder.addValidators(crossFieldRules);
    }

    @Override
    public ResponseEntity<List<ApiWaitlistEntry>> listOwnWaitlistEntries() {
        UserAccount account = currentUser.requireAccount();
        Map<UUID, String> labels = cards.allCards().stream()
                .collect(Collectors.toMap(BookingCard::getId, BookingCard::getLabel));
        return ResponseEntity.ok(waitlist.ownEntries(account.getId()).stream()
                .map(entry -> new ApiWaitlistEntry(entry.id(), entry.courtId(),
                        WireTypes.toOffsetDateTime(entry.slot().start()), WireTypes.toOffsetDateTime(entry.slot().end()),
                        labels.getOrDefault(entry.cardId(), "?"), ApiWaitlistEntryState.fromValue(entry.state().name()))
                        .offerExpiresAt(entry.offerExpiresAt() == null
                                ? null : WireTypes.toOffsetDateTime(entry.offerExpiresAt()))
                        .bookingId(entry.bookingId()))
                .toList());
    }

    @Override
    public ResponseEntity<ApiWaitlistJoined> joinWaitlist(ApiJoinWaitlistRequest request) {
        UserAccount account = currentUser.requireAccount();
        List<ParticipantSpec> participants = request.getParticipants() == null
                ? List.of()
                : request.getParticipants().stream()
                        .map(p -> ParticipantSpec.from(p.getPersonId(), p.getGuestName(), p.getCardId()))
                        .toList();
        UUID id = waitlist.join(new JoinWaitlistCommand(request.getCourtId(), request.getCardId(),
                new TimeSlot(WireTypes.toInstant(request.getStartsAt()), WireTypes.toInstant(request.getEndsAt())),
                account.getId(), account.getPerson().getId(), account.getRoles(), request.getNote(), participants));
        return ResponseEntity.status(HttpStatus.CREATED).body(new ApiWaitlistJoined(id));
    }

    @Override
    public ResponseEntity<Void> leaveWaitlist(UUID entryId) {
        waitlist.leave(entryId, currentUser.requireAccount().getId());
        return ResponseEntity.noContent().build();
    }

    @Override
    public ResponseEntity<ApiBookingCreated> acceptWaitlistOffer(UUID entryId) {
        UserAccount account = currentUser.requireAccount();
        UUID bookingId = waitlist.accept(entryId, account.getId(), account.getPerson().getId(), account.getRoles());
        return ResponseEntity.created(URI.create("/api/bookings/" + bookingId)).body(new ApiBookingCreated(bookingId));
    }

    @Override
    public ResponseEntity<List<ApiReservedSlot>> listReservedSlots(LocalDate date, LocalDate from, LocalDate to) {
        ZoneId zone = timeZone.zoneId();
        DayRange days = DayRange.of(date, from, to);
        UUID viewer = currentUser.accountReadyForUse().map(UserAccount::getId).orElse(null);
        return ResponseEntity.ok(waitlist.reservationsBetween(days.start(zone), days.end(zone), viewer).stream()
                .map(reservation -> new ApiReservedSlot(reservation.courtId(),
                        WireTypes.toOffsetDateTime(reservation.slot().start()),
                        WireTypes.toOffsetDateTime(reservation.slot().end()))
                        .ownEntryId(reservation.ownEntryId()))
                .toList());
    }
}
