package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.config.ClubIdentity;
import org.courtside.identity.UserAccount;
import org.courtside.notification.MessageKind;
import org.courtside.shared.BookingAnnouncement;
import org.courtside.shared.BookingAnnouncer;
import org.courtside.shared.BookingReminderDue;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionalEventListener;

import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

@Component
@RequiredArgsConstructor
class ReminderMailer {

    private final BookingAnnouncer bookings;
    private final BookingAudience audience;
    private final ClubIdentity club;
    private final MailTemplates templates;
    private final BookingWording wording;
    private final RecordedHandover handover;

    @Async("bookingMailExecutor")
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    @TransactionalEventListener
    void on(BookingReminderDue due) {
        bookings.describe(due.bookingId())
                .ifPresent(booking -> audience.of(booking).forEach(account -> send(booking, account)));
    }

    private void send(BookingAnnouncement booking, UserAccount account) {
        Locale locale = MessageLanguage.of(account.getLocale(), club.defaultLocale());
        String key = MessageKind.BOOKING_REMINDER.templateKey();
        Map<String, String> values = new HashMap<>(wording.of(booking, locale));
        values.put("firstName", account.getPerson().getFirstName());
        handover.handOver(account.getId(), MessageKind.BOOKING_REMINDER,
                account.getPerson().getEmail(),
                templates.render(key + ".subject", locale, values),
                templates.render(key + ".body", locale, values));
    }
}
