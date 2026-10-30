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
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.time.Duration;
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

    // Long enough for the access worker to install a booking's own code, so the confirmation can carry it.
    static final Duration ACCESS_CODE_WAIT = Duration.ofSeconds(10);

    private final BookingAnnouncer bookings;
    private final UserAccountRepository accounts;
    private final ClubIdentity club;
    private final MailTemplates templates;
    private final InstanceLinks links;
    private final BookingWording wording;
    private final BookingCalendar calendar;
    private final MessageOutbox outbox;

    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT, fallbackExecution = true)
    void on(BookingConfirmed confirmed) {
        Optional<BookingAnnouncement> announced = bookings.describe(confirmed.bookingId());
        if (announced.isEmpty()) {
            log.warn("Booking {} was confirmed but describes nothing to send", confirmed.bookingId());
            return;
        }
        Optional<UserAccount> recipient =
                MessageRecipient.enabled(accounts.findById(announced.get().bookedByAccountId()));
        if (recipient.isEmpty()) {
            log.info("Account {} is deactivated, so its booking confirmation stays unsent",
                    announced.get().bookedByAccountId());
            return;
        }
        outbox.queueAfter(recipient.get().getId(), MessageKind.BOOKING_CONFIRMED,
                Map.of(QueuedMessage.BOOKING, confirmed.bookingId().toString()),
                announced.get().dynamicAccess() == null ? Duration.ZERO : ACCESS_CODE_WAIT);
    }

    @Override
    public Set<MessageKind> kinds() {
        return Set.of(MessageKind.BOOKING_CONFIRMED);
    }

    @Override
    public void compose(QueuedMessage message, Consumer<OutgoingMail> handOver) {
        BookingAnnouncement booking = AnnouncedBooking.current(bookings, message.booking());
        UserAccount account = MessageRecipient.required(accounts, message.accountId());
        Locale locale = MessageLanguage.of(account.getLocale(), club.defaultLocale());
        String key = MessageKind.BOOKING_CONFIRMED.templateKey();
        Map<String, String> values = new HashMap<>(wording.of(booking, locale));
        BookingWording.AccessLines access = wording.access(message.booking(), booking, account, locale,
                BookingWording.CODE_FOLLOWS, true);
        values.put(BookingWording.ACCESS_CODES, access.text());
        values.put("firstName", account.getPerson().getFirstName());
        values.put(InstanceLinks.PLACEHOLDER, links.of(message));
        OutgoingMail mail = new OutgoingMail(account.getPerson().getEmail(),
                templates.render(key + ".subject", locale, values),
                templates.render(key + ".body", locale, values),
                calendar.create(message.booking(), booking, values.get("courts"),
                        values.get(InstanceLinks.PLACEHOLDER)));
        handOver.accept(access.codeFollows() ? mail.promisingAccessCodeOf(message.booking()) : mail);
    }
}
