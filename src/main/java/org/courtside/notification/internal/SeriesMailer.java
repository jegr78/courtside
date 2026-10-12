package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.courtside.config.ClubIdentity;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.notification.MessageKind;
import org.courtside.shared.BookingAnnouncement;
import org.courtside.shared.BookingAnnouncer;
import org.courtside.shared.SeriesCreated;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;

@Slf4j
@Component
@RequiredArgsConstructor
class SeriesMailer implements MessageComposer {

    private final BookingAnnouncer bookings;
    private final BookingAudience audience;
    private final UserAccountRepository accounts;
    private final ClubIdentity club;
    private final MailTemplates templates;
    private final BookingWording wording;
    private final MessageOutbox outbox;

    // The first occurrence is what the centre entry shows and links to.
    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT, fallbackExecution = true)
    void on(SeriesCreated created) {
        if (created.bookingIds().isEmpty()) {
            log.warn("Series {} was announced without an occurrence", created.seriesId());
            return;
        }
        String first = created.bookingIds().getFirst().toString();
        bookings.describe(created.bookingIds().getFirst()).ifPresent(booking -> audience.of(booking).forEach(account ->
                outbox.queue(account.getId(), MessageKind.BOOKING_SERIES_CREATED, Map.of(
                        QueuedMessage.BOOKING, first,
                        QueuedMessage.SERIES, created.seriesId().toString()))));
    }

    @Override
    public Set<MessageKind> kinds() {
        return Set.of(MessageKind.BOOKING_SERIES_CREATED);
    }

    @Override
    public void compose(QueuedMessage message, Consumer<OutgoingMail> handOver) {
        List<BookingAnnouncement> occurrences = bookings.describeSeries(message.series());
        if (occurrences.isEmpty()) {
            throw new MessageUndeliverableException("BookingCancelled");
        }
        UserAccount account = MessageRecipient.required(accounts, message.accountId());
        Locale locale = MessageLanguage.of(account.getLocale(), club.defaultLocale());
        Map<String, String> values = new HashMap<>(wording.ofSeries(occurrences, locale));
        values.put("firstName", account.getPerson().getFirstName());
        String key = MessageKind.BOOKING_SERIES_CREATED.templateKey();
        handOver.accept(new OutgoingMail(account.getPerson().getEmail(),
                templates.render(key + ".subject", locale, values),
                templates.render(key + ".body", locale, values)));
    }
}
