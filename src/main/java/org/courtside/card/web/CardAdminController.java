package org.courtside.card.web;

import org.courtside.api.AdminBookingCardsApi;
import org.courtside.api.AdminParticipantCardsApi;
import org.courtside.api.ApiActiveRequest;
import org.courtside.api.ApiBookingCard;
import org.courtside.api.ApiBookingCardRequest;
import org.courtside.api.ApiParticipantCard;
import org.courtside.api.ApiParticipantCardRequest;
import org.courtside.api.ApiRole;
import org.courtside.card.BookingCard;
import org.courtside.card.CardService;
import org.courtside.card.ParticipantCard;
import org.courtside.identity.Role;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.EnumSet;
import java.util.List;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

@RestController
@RequiredArgsConstructor
class CardAdminController implements AdminBookingCardsApi, AdminParticipantCardsApi {

    private final CardService cards;

    @Override
    public ResponseEntity<List<ApiBookingCard>> listBookingCards() {
        return ResponseEntity.ok(cards.allCards().stream()
                .map(CardAdminController::toResponse)
                .toList());
    }

    @Override
    public ResponseEntity<ApiBookingCard> createBookingCard(ApiBookingCardRequest request) {
        BookingCard card = cards.createCard(
                request.getLabel(), request.getColor(), roles(request.getAllowedRoles()),
                roles(request.getManagingRoles()),
                toPlayerCounts(request.getAllowedPlayerCounts()), request.getCountsAgainstLimits(),
                request.getGuestAllowed(), Boolean.TRUE.equals(request.getShowGenericOccupancy()));
        return ResponseEntity
                .created(URI.create("/api/admin/booking-cards/" + card.getId()))
                .body(toResponse(card));
    }

    @Override
    public ResponseEntity<ApiBookingCard> changeBookingCard(UUID id, ApiBookingCardRequest request) {
        return ResponseEntity.ok(toResponse(cards.changeCard(
                id, request.getLabel(), request.getColor(), roles(request.getAllowedRoles()),
                roles(request.getManagingRoles()),
                toPlayerCounts(request.getAllowedPlayerCounts()), request.getCountsAgainstLimits(),
                request.getGuestAllowed(), Boolean.TRUE.equals(request.getShowGenericOccupancy()))));
    }

    @Override
    public ResponseEntity<ApiBookingCard> setBookingCardActive(UUID id, ApiActiveRequest request) {
        return ResponseEntity.ok(toResponse(cards.setCardActive(id, request.getActive())));
    }

    @Override
    public ResponseEntity<ApiBookingCard> getBookingCard(UUID id) {
        return ResponseEntity.ok(toResponse(cards.requireCard(id)));
    }

    @Override
    public ResponseEntity<List<ApiParticipantCard>> listParticipantCardsForAdmin() {
        return ResponseEntity.ok(cards.allParticipantCards().stream()
                .map(CardAdminController::toResponse)
                .toList());
    }

    @Override
    public ResponseEntity<ApiParticipantCard> createParticipantCard(ApiParticipantCardRequest request) {
        ParticipantCard card = cards.createParticipantCard(request.getLabel(), request.getCapacity());
        return ResponseEntity
                .created(URI.create("/api/admin/participant-cards/" + card.getId()))
                .body(toResponse(card));
    }

    @Override
    public ResponseEntity<ApiParticipantCard> changeParticipantCard(
            UUID id, ApiParticipantCardRequest request) {
        return ResponseEntity.ok(toResponse(
                cards.changeParticipantCard(id, request.getLabel(), request.getCapacity())));
    }

    @Override
    public ResponseEntity<ApiParticipantCard> setParticipantCardActive(
            UUID id, ApiActiveRequest request) {
        return ResponseEntity.ok(
                toResponse(cards.setParticipantCardActive(id, request.getActive())));
    }

    @Override
    public ResponseEntity<ApiParticipantCard> getParticipantCard(UUID id) {
        return ResponseEntity.ok(toResponse(cards.requireParticipantCard(id)));
    }

    private static short[] toPlayerCounts(Collection<Integer> counts) {
        short[] result = new short[counts.size()];
        int index = 0;
        for (Integer count : counts) {
            result[index++] = count.shortValue();
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

    private static Set<Role> roles(Collection<ApiRole> requested) {
        Set<Role> result = EnumSet.noneOf(Role.class);
        if (requested == null) {
            return result;
        }
        for (ApiRole role : requested) {
            result.add(Role.named(role.getValue()).orElseThrow(() -> new IllegalStateException(
                    "Unvalidated role name reached the card boundary: " + role.getValue())));
        }
        return result;
    }

    private static Set<ApiRole> roleNames(Set<Role> allowedRoles) {
        return allowedRoles.stream()
                .sorted(Comparator.comparingInt(Enum::ordinal))
                .map(role -> ApiRole.fromValue(role.name()))
                .collect(Collectors.toCollection(LinkedHashSet::new));
    }

    private static ApiBookingCard toResponse(BookingCard card) {
        return new ApiBookingCard(
                card.getId(), card.getLabel(), card.getColor(),
                roleNames(card.getAllowedRoles()), roleNames(card.getManagingRoles()),
                toPlayerCountList(card.getAllowedPlayerCounts()), card.tracksPlayers(),
                card.isCountsAgainstLimits(), card.isGuestAllowed(), card.isShowGenericOccupancy(),
                card.isActive());
    }

    private static ApiParticipantCard toResponse(ParticipantCard card) {
        return new ApiParticipantCard(card.getId(), card.getLabel(), card.isActive())
                .capacity(card.getCapacity());
    }
}
