package org.courtside.card.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.config.ClubIdentity;
import org.courtside.config.ConfigEvent;
import org.courtside.shared.ShippedNames;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionalEventListener;

import java.util.Map;
import java.util.UUID;

@Component
@RequiredArgsConstructor
@Order(1)
class ShippedCardNaming implements ApplicationRunner {

    private static final Map<UUID, String> BOOKING_CARDS = Map.of(
            UUID.fromString("11111111-1111-1111-1111-111111111111"), "bookingCard.member",
            UUID.fromString("22222222-2222-2222-2222-222222222222"), "bookingCard.training",
            UUID.fromString("33333333-3333-3333-3333-333333333333"), "bookingCard.leagueMatch",
            UUID.fromString("44444444-4444-4444-4444-444444444444"), "bookingCard.courtClosed");

    private static final Map<UUID, String> PARTICIPANT_CARDS = Map.of(
            UUID.fromString("55555555-5555-5555-5555-555555555555"), "participantCard.ballMachine",
            UUID.fromString("66666666-6666-6666-6666-666666666666"),
            "participantCard.lookingForAPartner");

    private final BookingCardRepository bookingCards;
    private final ParticipantCardRepository participantCards;
    private final ClubIdentity club;
    private final ShippedNames names;

    @Override
    @Transactional
    public void run(ApplicationArguments arguments) {
        nameThemIn(club.defaultLocale());
    }

    @TransactionalEventListener
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    void whenTheClubChangesItsLanguage(ConfigEvent.LocaleChanged changed) {
        nameThemIn(changed.defaultLocale());
    }

    private void nameThemIn(String language) {
        BOOKING_CARDS.forEach((id, key) -> bookingCards.findById(id)
                .filter(card -> names.isStillTheShippedName(key, card.getLabel()))
                .ifPresent(card -> card.rename(names.in(key, language))));
        PARTICIPANT_CARDS.forEach((id, key) -> participantCards.findById(id)
                .filter(card -> names.isStillTheShippedName(key, card.getLabel()))
                .ifPresent(card -> card.rename(names.in(key, language))));
    }
}
