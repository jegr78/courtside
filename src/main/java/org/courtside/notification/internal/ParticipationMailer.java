package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.courtside.config.ClubIdentity;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.notification.MessageKind;
import org.courtside.shared.BookingAnnouncement;
import org.courtside.shared.BookingAnnouncer;
import org.courtside.shared.ParticipantRecorded;
import org.courtside.shared.ParticipantWithdrew;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Consumer;

@Slf4j
@Component
@RequiredArgsConstructor
class ParticipationMailer implements MessageComposer {

    private final BookingAnnouncer bookings;
    private final UserAccountRepository accounts;
    private final PersonRepository persons;
    private final ClubIdentity club;
    private final MailTemplates templates;
    private final BookingWording wording;
    private final MessageOutbox outbox;

    // The participation list resolves no name at all, not the booker's and not the other players',
    // so the message that says somebody was recorded names none of them either.
    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT, fallbackExecution = true)
    void on(ParticipantRecorded recorded) {
        bookings.describe(recorded.bookingId()).ifPresent(booking ->
                queue(accountOf(recorded.personId()), MessageKind.BOOKING_PLAYER_RECORDED,
                        Map.of(QueuedMessage.BOOKING, recorded.bookingId().toString())));
    }

    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT, fallbackExecution = true)
    void on(ParticipantWithdrew withdrew) {
        if (persons.findById(withdrew.personId()).isEmpty()) {
            log.warn("Person {} withdrew and is on no roster to name", withdrew.personId());
            return;
        }
        // The booker entered the name themselves, so it tells them nothing they did not have.
        bookings.describe(withdrew.bookingId()).ifPresent(booking ->
                queue(accounts.findById(booking.bookedByAccountId()), MessageKind.BOOKING_PLAYER_WITHDREW,
                        Map.of(QueuedMessage.BOOKING, withdrew.bookingId().toString(),
                                QueuedMessage.PLAYER, withdrew.personId().toString())));
    }

    private void queue(Optional<UserAccount> recipient, MessageKind kind, Map<String, String> parameters) {
        Optional<UserAccount> reachable = MessageRecipient.reachable(recipient);
        if (reachable.isEmpty()) {
            log.info("A {} message has nobody to reach", kind);
            return;
        }
        outbox.queue(reachable.get().getId(), kind, parameters);
    }

    @Override
    public Set<MessageKind> kinds() {
        return Set.of(MessageKind.BOOKING_PLAYER_RECORDED, MessageKind.BOOKING_PLAYER_WITHDREW);
    }

    @Override
    public void compose(QueuedMessage message, Consumer<OutgoingMail> handOver) {
        BookingAnnouncement booking = AnnouncedBooking.current(bookings, message.booking());
        UserAccount account = MessageRecipient.required(accounts, message.accountId());
        Locale locale = MessageLanguage.of(account.getLocale(), club.defaultLocale());
        Map<String, String> values = new HashMap<>(wording.of(booking, locale));
        values.put("firstName", account.getPerson().getFirstName());
        if (message.kind() == MessageKind.BOOKING_PLAYER_WITHDREW) {
            Person player = persons.findById(message.player())
                    .orElseThrow(() -> new MessageUndeliverableException("PlayerGone"));
            values.put("player", player.getFirstName() + " " + player.getLastName());
        }
        String key = message.kind().templateKey();
        handOver.accept(new OutgoingMail(account.getPerson().getEmail(),
                templates.render(key + ".subject", locale, values),
                templates.render(key + ".body", locale, values)));
    }

    private Optional<UserAccount> accountOf(UUID personId) {
        return accounts.findByPersonIdIn(List.of(personId)).stream().findFirst();
    }
}
