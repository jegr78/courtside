package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.config.ClubIdentity;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.notification.MessageKind;
import org.courtside.shared.BookingAnnouncement;
import org.courtside.shared.BookingAnnouncer;
import org.courtside.shared.BookingCancelled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;

@Component
@RequiredArgsConstructor
class CancellationMailer implements MessageComposer {

    private final BookingAnnouncer bookings;
    private final BookingAudience audience;
    private final UserAccountRepository accounts;
    private final ClubIdentity club;
    private final MailTemplates templates;
    private final InstanceLinks links;
    private final BookingWording wording;
    private final MessageOutbox outbox;

    // Whoever cancelled knows it already, and anyone but the holder cancels on the club's behalf.
    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT, fallbackExecution = true)
    void on(BookingCancelled cancelled) {
        bookings.describe(cancelled.bookingId()).ifPresent(booking -> {
            MessageKind kind = cancelled.cancelledByAccountId().equals(booking.bookedByAccountId())
                    ? MessageKind.BOOKING_CANCELLED
                    : MessageKind.BOOKING_CANCELLED_BY_CLUB;
            Map<String, String> parameters = new HashMap<>();
            parameters.put(QueuedMessage.BOOKING, cancelled.bookingId().toString());
            if (cancelled.reason() != null) {
                parameters.put(QueuedMessage.REASON, cancelled.reason().name());
            }
            audience.of(booking).stream()
                    .filter(account -> !account.getId().equals(cancelled.cancelledByAccountId()))
                    .forEach(account -> outbox.queue(account.getId(), kind, parameters));
        });
    }

    @Override
    public Set<MessageKind> kinds() {
        return Set.of(MessageKind.BOOKING_CANCELLED, MessageKind.BOOKING_CANCELLED_BY_CLUB);
    }

    @Override
    public void compose(QueuedMessage message, Consumer<OutgoingMail> handOver) {
        BookingAnnouncement booking = AnnouncedBooking.existing(bookings, message.booking());
        UserAccount account = MessageRecipient.required(accounts, message.accountId());
        Locale locale = MessageLanguage.of(account.getLocale(), club.defaultLocale());
        Map<String, String> values = new HashMap<>(wording.of(booking, locale));
        values.put("firstName", account.getPerson().getFirstName());
        values.put(InstanceLinks.PLACEHOLDER, links.of(message));
        values.put("reason", wording.reason(message.reason(), locale));
        String key = message.kind().templateKey();
        handOver.accept(new OutgoingMail(account.getPerson().getEmail(),
                templates.render(key + ".subject", locale, values),
                templates.render(key + ".body", locale, values)));
    }
}
