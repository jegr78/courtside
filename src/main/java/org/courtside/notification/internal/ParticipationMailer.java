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
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionalEventListener;

import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Slf4j
@Component
@RequiredArgsConstructor
class ParticipationMailer {

    private final BookingAnnouncer bookings;
    private final UserAccountRepository accounts;
    private final PersonRepository persons;
    private final ClubIdentity club;
    private final MailTemplates templates;
    private final BookingWording wording;
    private final RecordedHandover handover;

    // The participation list resolves no name at all, not the booker's and not the other players',
    // so the message that says somebody was recorded names none of them either.
    @Async("bookingMailExecutor")
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    @TransactionalEventListener
    void on(ParticipantRecorded recorded) {
        bookings.describe(recorded.bookingId()).ifPresent(booking ->
                send(booking, accountOf(recorded.personId()),
                        MessageKind.BOOKING_PLAYER_RECORDED, Map.of()));
    }

    @Async("bookingMailExecutor")
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    @TransactionalEventListener
    void on(ParticipantWithdrew withdrew) {
        Optional<Person> player = persons.findById(withdrew.personId());
        if (player.isEmpty()) {
            log.warn("Person {} withdrew and is on no roster to name", withdrew.personId());
            return;
        }
        // The booker entered the name themselves, so it tells them nothing they did not have.
        bookings.describe(withdrew.bookingId()).ifPresent(booking ->
                send(booking, accounts.findById(booking.bookedByAccountId()),
                        MessageKind.BOOKING_PLAYER_WITHDREW, Map.of("player", nameOf(player.get()))));
    }

    private void send(BookingAnnouncement booking, Optional<UserAccount> recipient,
                      MessageKind kind, Map<String, String> extra) {
        Optional<UserAccount> reachable = MessageRecipient.reachable(recipient);
        if (reachable.isEmpty()) {
            log.info("A {} message has nobody to reach", kind);
            return;
        }
        UserAccount account = reachable.get();
        String address = account.getPerson().getEmail();
        Locale locale = MessageLanguage.of(account.getLocale(), club.defaultLocale());
        Map<String, String> values = new HashMap<>(wording.of(booking, locale));
        values.put("firstName", account.getPerson().getFirstName());
        values.putAll(extra);
        handover.handOver(account.getId(), kind, address,
                templates.render(kind.templateKey() + ".subject", locale, values),
                templates.render(kind.templateKey() + ".body", locale, values));
    }

    private Optional<UserAccount> accountOf(UUID personId) {
        return accounts.findByPersonIdIn(List.of(personId)).stream().findFirst();
    }

    private static String nameOf(Person person) {
        return person.getFirstName() + " " + person.getLastName();
    }
}
