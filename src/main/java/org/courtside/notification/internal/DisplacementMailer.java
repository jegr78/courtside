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
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
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
    private final BookingWording wording;
    private final MessageOutbox outbox;

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    @TransactionalEventListener
    void on(BookingDisplaced displaced) {
        bookings.describe(displaced.bookingId()).ifPresent(booking -> audience.of(booking).forEach(account ->
                outbox.queue(account.getId(), MessageKind.BOOKING_DISPLACED, Map.of(
                        QueuedMessage.BOOKING, displaced.bookingId().toString(),
                        QueuedMessage.CLOSURE, displaced.closure().name()))));
    }

    @Override
    public Set<MessageKind> kinds() {
        return Set.of(MessageKind.BOOKING_DISPLACED);
    }

    @Override
    public void compose(QueuedMessage message, Consumer<OutgoingMail> handOver) {
        BookingDisplaced.Closure closure = closureOf(message.closure());
        BookingAnnouncement booking = bookings.describe(message.booking())
                .orElseThrow(() -> new MessageUndeliverableException("BookingGone"));
        UserAccount account = MessageRecipient.required(accounts, message.accountId());
        Locale locale = MessageLanguage.of(account.getLocale(), club.defaultLocale());
        String key = MessageKind.BOOKING_DISPLACED.templateKey();
        Map<String, String> values = new HashMap<>(wording.of(booking, locale));
        values.put("firstName", account.getPerson().getFirstName());
        values.put("closure", templates.render(key + "." + closureKey(closure), locale, values));
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
        };
    }
}
