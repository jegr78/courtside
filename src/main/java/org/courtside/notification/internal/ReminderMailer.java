package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.config.ClubIdentity;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.notification.MessageKind;
import org.courtside.shared.BookingAnnouncement;
import org.courtside.shared.BookingAnnouncer;
import org.courtside.shared.BookingReminderDue;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.time.Clock;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;

@Component
@RequiredArgsConstructor
class ReminderMailer implements MessageComposer {

    private final BookingAnnouncer bookings;
    private final BookingAudience audience;
    private final UserAccountRepository accounts;
    private final ClubIdentity club;
    private final MailTemplates templates;
    private final BookingWording wording;
    private final MessageOutbox outbox;
    private final Clock clock;

    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT, fallbackExecution = true)
    void on(BookingReminderDue due) {
        bookings.describe(due.bookingId()).ifPresent(booking -> audience.of(booking).forEach(account ->
                outbox.queue(account.getId(), MessageKind.BOOKING_REMINDER,
                        Map.of(QueuedMessage.BOOKING, due.bookingId().toString()))));
    }

    @Override
    public Set<MessageKind> kinds() {
        return Set.of(MessageKind.BOOKING_REMINDER);
    }

    @Override
    public void compose(QueuedMessage message, Consumer<OutgoingMail> handOver) {
        BookingAnnouncement booking = AnnouncedBooking.current(bookings, message.booking());
        if (!booking.startsAt().isAfter(clock.instant())) {
            throw new MessageUndeliverableException("BookingStarted");
        }
        UserAccount account = MessageRecipient.required(accounts, message.accountId());
        Locale locale = MessageLanguage.of(account.getLocale(), club.defaultLocale());
        String key = MessageKind.BOOKING_REMINDER.templateKey();
        Map<String, String> values = new HashMap<>(wording.of(booking, locale));
        values.put("firstName", account.getPerson().getFirstName());
        handOver.accept(new OutgoingMail(account.getPerson().getEmail(),
                templates.render(key + ".subject", locale, values),
                templates.render(key + ".body", locale, values)));
    }
}
