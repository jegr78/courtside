package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.courtside.config.ClubIdentity;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.notification.MessageKind;
import org.courtside.shared.BookingAnnouncement;
import org.courtside.shared.BookingAnnouncer;
import org.courtside.shared.BookingConfirmed;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionalEventListener;

import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.function.Consumer;

@Slf4j
@Component
@RequiredArgsConstructor
class BookingMailer implements MessageComposer {

    private final BookingAnnouncer bookings;
    private final UserAccountRepository accounts;
    private final ClubIdentity club;
    private final MailTemplates templates;
    private final BookingWording wording;
    private final BookingCalendar calendar;
    private final MessageOutbox outbox;

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    @TransactionalEventListener
    void on(BookingConfirmed confirmed) {
        Optional<BookingAnnouncement> announced = bookings.describe(confirmed.bookingId());
        if (announced.isEmpty()) {
            log.warn("Booking {} was confirmed but describes nothing to send", confirmed.bookingId());
            return;
        }
        Optional<UserAccount> recipient =
                MessageRecipient.reachable(accounts.findById(announced.get().bookedByAccountId()));
        if (recipient.isEmpty()) {
            log.info("Account {} cannot be reached, so its booking confirmation stays unsent",
                    announced.get().bookedByAccountId());
            return;
        }
        outbox.queue(recipient.get().getId(), MessageKind.BOOKING_CONFIRMED,
                Map.of(QueuedMessage.BOOKING, confirmed.bookingId().toString()));
    }

    @Override
    public Set<MessageKind> kinds() {
        return Set.of(MessageKind.BOOKING_CONFIRMED);
    }

    @Override
    public void compose(QueuedMessage message, Consumer<OutgoingMail> handOver) {
        BookingAnnouncement booking = bookings.describe(message.booking())
                .orElseThrow(() -> new MessageUndeliverableException("BookingGone"));
        UserAccount account = MessageRecipient.required(accounts, message.accountId());
        Locale locale = MessageLanguage.of(account.getLocale(), club.defaultLocale());
        String key = MessageKind.BOOKING_CONFIRMED.templateKey();
        Map<String, String> values = new HashMap<>(wording.of(booking, locale));
        values.put("firstName", account.getPerson().getFirstName());
        handOver.accept(new OutgoingMail(account.getPerson().getEmail(),
                templates.render(key + ".subject", locale, values),
                templates.render(key + ".body", locale, values),
                calendar.create(message.booking(), booking, values.get("courts"))));
    }
}
