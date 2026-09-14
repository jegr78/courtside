package org.courtside.card.internal;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.courtside.card.BookingCard;
import org.courtside.card.ParticipantCard;
import org.courtside.config.ClubIdentity;
import org.courtside.config.ConfigEvent;
import org.courtside.shared.ShippedNames;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionalEventListener;

import java.util.Map;
import java.util.UUID;

@Component
@RequiredArgsConstructor
@Slf4j
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
    public void run(ApplicationArguments arguments) {
        nameThemIn(club.defaultLocale());
    }

    // The entity manager bound to the transaction that just committed is spent, so a write after
    // it needs one of its own. Startup deliberately has none: a runner that throws stops the club.
    @TransactionalEventListener
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    void whenTheClubChangesItsLanguage(ConfigEvent.LocaleChanged changed) {
        nameThemIn(changed.defaultLocale());
    }

    // A row at a time, each in its own transaction: a name one row cannot take is no reason for the
    // rest to keep theirs, and no reason at all for an instance to refuse to start.
    private void nameThemIn(String language) {
        BOOKING_CARDS.forEach((id, key) -> bookingCards.findById(id)
                .filter(card -> names.isStillTheShippedName(key, card.getLabel()))
                .ifPresent(card -> renameBookingCard(card, names.in(key, language))));
        PARTICIPANT_CARDS.forEach((id, key) -> participantCards.findById(id)
                .filter(card -> names.isStillTheShippedName(key, card.getLabel()))
                .ifPresent(card -> renameParticipantCard(card, names.in(key, language))));
    }

    private void renameBookingCard(BookingCard card, String name) {
        if (name.equals(card.getLabel()) || bookingCards.existsByLabel(name)) {
            return;
        }
        card.rename(name);
        try {
            bookingCards.saveAndFlush(card);
        } catch (DataIntegrityViolationException taken) {
            log.warn("A shipped booking card keeps its name: {} was taken meanwhile", name);
        }
    }

    private void renameParticipantCard(ParticipantCard card, String name) {
        if (name.equals(card.getLabel()) || participantCards.existsByLabel(name)) {
            return;
        }
        card.rename(name);
        try {
            participantCards.saveAndFlush(card);
        } catch (DataIntegrityViolationException taken) {
            log.warn("A shipped slot filler keeps its name: {} was taken meanwhile", name);
        }
    }
}
