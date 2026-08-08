package org.courtside.card.web;

import org.courtside.card.BookingCard;
import org.courtside.card.CardService;
import org.courtside.card.ParticipantCard;
import org.courtside.card.web.CardAdminWebModels.BookingCardRequest;
import org.courtside.card.web.CardAdminWebModels.BookingCardResponse;
import org.courtside.card.web.CardAdminWebModels.ParticipantCardRequest;
import org.courtside.card.web.CardAdminWebModels.ParticipantCardResponse;
import org.courtside.shared.ActiveRequest;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/admin")
@RequiredArgsConstructor
class CardAdminController {

    private final CardService cards;

    @GetMapping("/booking-cards")
    List<BookingCardResponse> bookingCards() {
        return cards.allCards().stream()
                .map(CardAdminController::toResponse)
                .toList();
    }

    @PostMapping("/booking-cards")
    ResponseEntity<BookingCardResponse> createBookingCard(
            @Valid @RequestBody BookingCardRequest request) {
        BookingCard card = cards.createCard(request.label(), request.color(), request.requiredRole(),
                toPlayerCounts(request.allowedPlayerCounts()), request.countsAgainstLimits(),
                request.guestAllowed());
        return ResponseEntity
                .created(URI.create("/api/admin/booking-cards/" + card.getId()))
                .body(toResponse(card));
    }

    @PutMapping("/booking-cards/{id}")
    BookingCardResponse changeBookingCard(@PathVariable UUID id,
                                          @Valid @RequestBody BookingCardRequest request) {
        BookingCard card = cards.changeCard(id, request.label(), request.color(), request.requiredRole(),
                toPlayerCounts(request.allowedPlayerCounts()), request.countsAgainstLimits(),
                request.guestAllowed());
        return toResponse(card);
    }

    @PutMapping("/booking-cards/{id}/active")
    BookingCardResponse setBookingCardActive(@PathVariable UUID id,
                                             @Valid @RequestBody ActiveRequest request) {
        return toResponse(cards.setCardActive(id, request.active()));
    }

    @GetMapping("/booking-cards/{id}")
    BookingCardResponse bookingCard(@PathVariable UUID id) {
        return toResponse(cards.requireCard(id));
    }

    @GetMapping("/participant-cards")
    List<ParticipantCardResponse> participantCards() {
        return cards.allParticipantCards().stream()
                .map(CardAdminController::toResponse)
                .toList();
    }

    @PostMapping("/participant-cards")
    ResponseEntity<ParticipantCardResponse> createParticipantCard(
            @Valid @RequestBody ParticipantCardRequest request) {
        ParticipantCard card = cards.createParticipantCard(request.label(), request.capacity());
        return ResponseEntity
                .created(URI.create("/api/admin/participant-cards/" + card.getId()))
                .body(toResponse(card));
    }

    @PutMapping("/participant-cards/{id}")
    ParticipantCardResponse changeParticipantCard(@PathVariable UUID id,
                                                  @Valid @RequestBody ParticipantCardRequest request) {
        ParticipantCard card = cards.changeParticipantCard(id, request.label(), request.capacity());
        return toResponse(card);
    }

    @PutMapping("/participant-cards/{id}/active")
    ParticipantCardResponse setParticipantCardActive(@PathVariable UUID id,
                                                      @Valid @RequestBody ActiveRequest request) {
        return toResponse(cards.setParticipantCardActive(id, request.active()));
    }

    @GetMapping("/participant-cards/{id}")
    ParticipantCardResponse participantCard(@PathVariable UUID id) {
        return toResponse(cards.requireParticipantCard(id));
    }

    private static short[] toPlayerCounts(List<Integer> counts) {
        short[] result = new short[counts.size()];
        for (int i = 0; i < counts.size(); i++) {
            result[i] = counts.get(i).shortValue();
        }
        return result;
    }

    private static List<Integer> toPlayerCountList(short[] counts) {
        List<Integer> result = new ArrayList<>(counts.length);
        for (short count : counts) {
            result.add((int) count);
        }
        return result;
    }

    private static BookingCardResponse toResponse(BookingCard card) {
        return new BookingCardResponse(
                card.getId(), card.getLabel(), card.getColor(), card.getRequiredRole(),
                toPlayerCountList(card.getAllowedPlayerCounts()), card.tracksPlayers(),
                card.isCountsAgainstLimits(), card.isGuestAllowed(), card.isActive());
    }

    private static ParticipantCardResponse toResponse(ParticipantCard card) {
        return new ParticipantCardResponse(
                card.getId(), card.getLabel(), card.getCapacity(), card.isActive());
    }
}
