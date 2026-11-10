package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.config.ClubIdentity;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.notification.MessageKind;
import org.courtside.shared.BookingAnnouncement;
import org.courtside.shared.BookingAnnouncer;
import org.courtside.shared.BookingDisplaced;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.util.Arrays;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;

@Component
@RequiredArgsConstructor
class DisplacementMailer implements MessageComposer {

    private final BookingAnnouncer bookings;
    private final BookingAudience audience;
    private final UserAccountRepository accounts;
    private final ClubIdentity club;
    private final MailTemplates templates;
    private final InstanceLinks links;
    private final BookingWording wording;
    private final MessageOutbox outbox;

    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT, fallbackExecution = true)
    void on(BookingDisplaced displaced) {
        Map<String, String> parameters = new HashMap<>(Map.of(
                QueuedMessage.BOOKING, displaced.bookingId().toString(),
                QueuedMessage.CLOSURE, displaced.closure().name()));
        MessageKind kind = displaced.cancelled() ? MessageKind.BOOKING_DISPLACED_CANCELLED
                : MessageKind.BOOKING_DISPLACED;
        bookings.describe(displaced.bookingId()).ifPresent(booking -> audience.of(booking).forEach(account ->
                outbox.queue(account.getId(), kind, parameters)));
    }

    @Override
    public Set<MessageKind> kinds() {
        return Set.of(MessageKind.BOOKING_DISPLACED, MessageKind.BOOKING_DISPLACED_CANCELLED);
    }

    @Override
    public void compose(QueuedMessage message, Consumer<OutgoingMail> handOver) {
        BookingDisplaced.Closure closure = closureOf(message.closure());
        boolean cancelled = message.kind() == MessageKind.BOOKING_DISPLACED_CANCELLED;
        BookingAnnouncement booking = cancelled ? AnnouncedBooking.existing(bookings, message.booking())
                : AnnouncedBooking.current(bookings, message.booking());
        UserAccount account = MessageRecipient.required(accounts, message.accountId());
        Locale locale = MessageLanguage.of(account.getLocale(), club.defaultLocale());
        String displaced = MessageKind.BOOKING_DISPLACED.templateKey();
        String key = message.kind().templateKey();
        Map<String, String> values = new HashMap<>(wording.of(booking, locale));
        values.put("firstName", account.getPerson().getFirstName());
        values.put(InstanceLinks.PLACEHOLDER, links.of(message));
        values.put("closure", templates.render(displaced + "." + closureKey(closure), locale, values));
        values.put("refund", wording.refund(booking, account, locale));
        handOver.accept(new OutgoingMail(account.getPerson().getEmail(),
                templates.render(key + ".subject", locale, values),
                templates.render(key + ".body", locale, values)));
    }

    private static BookingDisplaced.Closure closureOf(String stored) {
        return Arrays.stream(BookingDisplaced.Closure.values())
                .filter(closure -> closure.name().equals(stored))
                .findFirst()
                .orElseThrow(() -> new MessageUndeliverableException("ParameterMalformed"));
    }

    private static String closureKey(BookingDisplaced.Closure closure) {
        return switch (closure) {
            case COURT_OUT_OF_SERVICE -> "court";
            case CARD_OUT_OF_SERVICE -> "card";
            case DAY_CLOSED -> "day";
            case HOURS_NARROWED -> "hours";
            case HOLIDAY -> "holiday";
            case SEASON -> "season";
            case COURT_CLOSED -> "courtClosed";
        };
    }
}
