package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.config.ClubIdentity;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.notification.MessageKind;
import org.courtside.shared.BookingAnnouncement;
import org.courtside.shared.BookingAnnouncer;
import org.courtside.shared.SeriesCancelled;
import org.courtside.shared.SeriesCreated;
import org.courtside.shared.SeriesMoved;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.SequencedMap;
import java.util.Set;
import java.util.UUID;
import java.util.function.Consumer;
import java.util.stream.Collectors;

@Component
@RequiredArgsConstructor
class SeriesMailer implements MessageComposer {

    private final BookingAnnouncer bookings;
    private final BookingAudience audience;
    private final UserAccountRepository accounts;
    private final ClubIdentity club;
    private final MailTemplates templates;
    private final InstanceLinks links;
    private final BookingWording wording;
    private final MessageOutbox outbox;

    // The first occurrence is what the centre entry shows and links to.
    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT, fallbackExecution = true)
    void on(SeriesCreated created) {
        String first = created.bookingIds().getFirst().toString();
        bookings.describe(created.bookingIds().getFirst()).ifPresent(booking -> audience.of(booking).forEach(account ->
                outbox.queue(account.getId(), MessageKind.BOOKING_SERIES_CREATED, Map.of(
                        QueuedMessage.BOOKING, first,
                        QueuedMessage.SERIES, created.seriesId().toString()))));
    }

    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT, fallbackExecution = true)
    void on(SeriesCancelled cancelled) {
        Map<String, String> parameters = new HashMap<>();
        if (cancelled.reason() != null) {
            parameters.put(QueuedMessage.REASON, cancelled.reason().name());
        }
        announceChange(cancelled.bookingIds(), cancelled.cancelledByAccountId(),
                MessageKind.BOOKING_SERIES_CANCELLED_BY_CLUB, parameters);
    }

    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT, fallbackExecution = true)
    void on(SeriesMoved moved) {
        announceChange(moved.bookingIds(), moved.movedByAccountId(), MessageKind.BOOKING_SERIES_MOVED_BY_CLUB,
                Map.of(QueuedMessage.PREVIOUS_STARTS_AT, moved.previousStartsAt().toString(),
                        QueuedMessage.PREVIOUS_ENDS_AT, moved.previousEndsAt().toString(),
                        QueuedMessage.PREVIOUS_COURTS, moved.previousCourtIds().stream().map(UUID::toString)
                                .collect(Collectors.joining(","))));
    }

    // Only the holder is told, so the dates of a series never reach a third account.
    private void announceChange(List<UUID> bookingIds, UUID actorAccountId, MessageKind kind,
                                Map<String, String> details) {
        SequencedMap<UUID, BookingAnnouncement> affected = bookings.describeAll(bookingIds);
        if (affected.isEmpty()) {
            return;
        }
        UUID holder = affected.firstEntry().getValue().bookedByAccountId();
        if (holder.equals(actorAccountId)) {
            return;
        }
        Map<String, String> parameters = new HashMap<>(details);
        parameters.put(QueuedMessage.BOOKING, affected.firstEntry().getKey().toString());
        parameters.put(QueuedMessage.BOOKINGS, bookingIds.stream().map(UUID::toString)
                .collect(Collectors.joining(",")));
        MessageRecipient.enabled(accounts.findById(holder))
                .ifPresent(account -> outbox.queue(account.getId(), kind, parameters));
    }

    @Override
    public Set<MessageKind> kinds() {
        return Set.of(MessageKind.BOOKING_SERIES_CREATED, MessageKind.BOOKING_SERIES_CANCELLED_BY_CLUB,
                MessageKind.BOOKING_SERIES_MOVED_BY_CLUB);
    }

    @Override
    public void compose(QueuedMessage message, Consumer<OutgoingMail> handOver) {
        List<BookingAnnouncement> occurrences = message.kind() == MessageKind.BOOKING_SERIES_CREATED
                ? bookings.describeSeries(message.series())
                : List.copyOf(bookings.describeAll(message.bookings()).values());
        if (occurrences.isEmpty()) {
            throw new MessageUndeliverableException(message.kind() == MessageKind.BOOKING_SERIES_CREATED
                    ? "BookingCancelled" : "BookingGone");
        }
        UserAccount account = MessageRecipient.required(accounts, message.accountId());
        Locale locale = MessageLanguage.of(account.getLocale(), club.defaultLocale());
        Map<String, String> values = new HashMap<>(wording.ofSeries(occurrences, locale));
        values.put("firstName", account.getPerson().getFirstName());
        values.put(InstanceLinks.PLACEHOLDER, links.of(message));
        if (message.kind() == MessageKind.BOOKING_SERIES_CANCELLED_BY_CLUB) {
            values.put("reason", wording.reason(message.reason(), locale));
        }
        if (message.kind() == MessageKind.BOOKING_SERIES_MOVED_BY_CLUB) {
            values.putAll(wording.previous(message.previousStartsAt(), message.previousEndsAt(),
                    bookings.describeCourts(message.previousCourts()), locale));
        }
        String key = message.kind().templateKey();
        handOver.accept(new OutgoingMail(account.getPerson().getEmail(),
                templates.render(key + ".subject", locale, values),
                templates.render(key + ".body", locale, values)));
    }
}
