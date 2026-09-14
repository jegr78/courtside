package org.courtside.card.internal;

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
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.Map;
import java.util.UUID;

@Component
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
    private final TransactionTemplate ownTransaction;

    ShippedCardNaming(BookingCardRepository bookingCards, ParticipantCardRepository participantCards,
                      ClubIdentity club, ShippedNames names, PlatformTransactionManager transactions) {
        this.bookingCards = bookingCards;
        this.participantCards = participantCards;
        this.club = club;
        this.names = names;
        // One of its own per row, for two reasons: a name one row cannot take is no reason for the
        // rest to keep theirs, and after a commit the entity manager bound to it is spent.
        this.ownTransaction = new TransactionTemplate(transactions);
        this.ownTransaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    @Override
    public void run(ApplicationArguments arguments) {
        nameThemIn(club.defaultLocale());
    }

    @TransactionalEventListener
    void whenTheClubChangesItsLanguage(ConfigEvent.LocaleChanged changed) {
        nameThemIn(changed.defaultLocale());
    }

    private void nameThemIn(String language) {
        BOOKING_CARDS.forEach((id, key) -> bookingCards.findById(id)
                .filter(card -> names.isStillTheShippedName(key, card.getLabel()))
                .ifPresent(card -> renameBookingCard(card, names.in(key, language))));
        PARTICIPANT_CARDS.forEach((id, key) -> participantCards.findById(id)
                .filter(card -> names.isStillTheShippedName(key, card.getLabel()))
                .ifPresent(card -> renameParticipantCard(card, names.in(key, language))));
    }

    private void renameBookingCard(BookingCard card, String name) {
        if (name.equals(card.getLabel())) {
            return;
        }
        card.rename(name);
        nameIt(() -> bookingCards.saveAndFlush(card), name);
    }

    private void renameParticipantCard(ParticipantCard card, String name) {
        if (name.equals(card.getLabel())) {
            return;
        }
        card.rename(name);
        nameIt(() -> participantCards.saveAndFlush(card), name);
    }

    // Every one of these names is unique per table, so a club already using this one keeps it and
    // the row keeps the name it has. Naming is never a reason for an instance not to start.
    private void nameIt(Runnable save, String name) {
        try {
            ownTransaction.executeWithoutResult(status -> save.run());
        } catch (DataIntegrityViolationException taken) {
            log.info("A shipped row keeps its name, because {} is already in use", name);
        }
    }
}
