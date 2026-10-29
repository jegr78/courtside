package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.courtside.config.ClubIdentity;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.notification.MessageKind;
import org.courtside.shared.BookingAccessCodeChanged;
import org.courtside.shared.BookingAnnouncement;
import org.courtside.shared.BookingAnnouncer;
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
class AccessCodeMailer implements MessageComposer {

    private final BookingAnnouncer bookings;
    private final BookingAudience audience;
    private final UserAccountRepository accounts;
    private final ClubIdentity club;
    private final MailTemplates templates;
    private final InstanceLinks links;
    private final BookingWording wording;
    private final MessageOutbox outbox;

    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT, fallbackExecution = true)
    void on(BookingAccessCodeChanged changed) {
        List<UserAccount> told = bookings.describe(changed.bookingId())
                .filter(booking -> booking.access() != null)
                .map(audience::of).orElse(List.of());
        if (told.isEmpty()) {
            log.info("Booking {} holds no access code anybody in it can be told of", changed.bookingId());
        }
        told.forEach(account -> outbox.queue(account.getId(), MessageKind.ACCESS_CODE_CHANGED,
                Map.of(QueuedMessage.BOOKING, changed.bookingId().toString())));
    }

    @Override
    public Set<MessageKind> kinds() {
        return Set.of(MessageKind.ACCESS_CODE_CHANGED);
    }

    // The code is read when the message is written, so a second change before then sends the latest one.
    @Override
    public void compose(QueuedMessage message, Consumer<OutgoingMail> handOver) {
        BookingAnnouncement booking = AnnouncedBooking.current(bookings, message.booking());
        if (booking.access() == null) {
            throw new MessageUndeliverableException("AccessWithdrawn");
        }
        UserAccount account = MessageRecipient.required(accounts, message.accountId());
        if (!BookingWording.holds(booking, account)) {
            throw new MessageUndeliverableException("NotInBooking");
        }
        Locale locale = MessageLanguage.of(account.getLocale(), club.defaultLocale());
        String key = MessageKind.ACCESS_CODE_CHANGED.templateKey();
        Map<String, String> values = new HashMap<>(wording.of(booking, account, locale));
        values.put("firstName", account.getPerson().getFirstName());
        values.put(InstanceLinks.PLACEHOLDER, links.of(message));
        handOver.accept(new OutgoingMail(account.getPerson().getEmail(),
                templates.render(key + ".subject", locale, values),
                templates.render(key + ".body", locale, values)));
    }
}
