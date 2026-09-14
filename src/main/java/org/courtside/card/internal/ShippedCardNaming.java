package org.courtside.card.internal;

import lombok.extern.slf4j.Slf4j;
import org.courtside.config.ClubIdentity;
import org.courtside.config.ConfigEvent;
import org.courtside.shared.ShippedNames;
import org.courtside.shared.SqlConstraintViolation;
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

    private static final String UNIQUE_BOOKING_CARD_LABEL = "booking_card_unique_label";
    private static final String UNIQUE_PARTICIPANT_CARD_LABEL = "participant_card_unique_label";

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
        BOOKING_CARDS.forEach((id, key) -> nameOrKeepTakenLabel(
                () -> bookingCards.nameShippedCard(id, names.in(key, language),
                        names.everyLanguage(key)), key, UNIQUE_BOOKING_CARD_LABEL));
        PARTICIPANT_CARDS.forEach((id, key) -> nameOrKeepTakenLabel(
                () -> participantCards.nameShippedCard(id, names.in(key, language),
                        names.everyLanguage(key)), key, UNIQUE_PARTICIPANT_CARD_LABEL));
    }

    // A name already in use is the one failure naming expects, and it is never a reason for an
    // instance not to start; any other violation is this image's own bug rather than a club's data.
    private void nameOrKeepTakenLabel(Runnable name, String key, String constraint) {
        try {
            ownTransaction.executeWithoutResult(status -> name.run());
        } catch (DataIntegrityViolationException e) {
            if (!SqlConstraintViolation.matches(
                    e, SqlConstraintViolation.UNIQUE_VIOLATION, constraint)) {
                throw e;
            }
            log.info("The shipped row {} keeps the name it has, because the one its club's language"
                    + " gives it is already in use", key);
        }
    }
}
