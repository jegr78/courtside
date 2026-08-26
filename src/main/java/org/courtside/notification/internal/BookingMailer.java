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
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionalEventListener;

import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;

@Slf4j
@Component
@RequiredArgsConstructor
class BookingMailer {

    private final BookingAnnouncer bookings;
    private final UserAccountRepository accounts;
    private final ClubIdentity club;
    private final MailTemplates templates;
    private final BookingWording wording;
    private final RecordedHandover handover;

    @Async("bookingMailExecutor")
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    @TransactionalEventListener
    void on(BookingConfirmed confirmed) {
        Optional<BookingAnnouncement> announced = bookings.describe(confirmed.bookingId());
        if (announced.isEmpty()) {
            log.warn("Booking {} was confirmed but describes nothing to send", confirmed.bookingId());
            return;
        }
        BookingAnnouncement booking = announced.get();
        Optional<UserAccount> recipient =
                MessageRecipient.reachable(accounts.findById(booking.bookedByAccountId()));
        if (recipient.isEmpty()) {
            log.info("Account {} cannot be reached, so its booking confirmation stays unsent",
                    booking.bookedByAccountId());
            return;
        }
        send(booking, recipient.get(), recipient.get().getPerson().getEmail());
    }

    private void send(BookingAnnouncement booking, UserAccount account, String address) {
        Locale locale = MessageLanguage.of(account.getLocale(), club.defaultLocale());
        String key = MessageKind.BOOKING_CONFIRMED.templateKey();
        Map<String, String> values = new HashMap<>(wording.of(booking, locale));
        values.put("firstName", account.getPerson().getFirstName());
        handover.handOver(account.getId(), MessageKind.BOOKING_CONFIRMED, address,
                templates.render(key + ".subject", locale, values),
                templates.render(key + ".body", locale, values));
    }
}
