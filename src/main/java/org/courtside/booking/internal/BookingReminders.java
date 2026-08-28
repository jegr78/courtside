package org.courtside.booking.internal;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.courtside.booking.BookingRepository;
import org.courtside.config.BookingReminderPolicy;
import org.courtside.config.ReminderLeadTime;
import org.courtside.shared.BookingReminderDue;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.UUID;

@Slf4j
@Component
@RequiredArgsConstructor
public class BookingReminders {

    private final BookingRepository bookings;
    private final BookingReminderPolicy policy;
    private final ApplicationEventPublisher events;
    private final Clock clock;

    @Transactional
    public void remindWhatIsDue() {
        ReminderLeadTime leadTime = policy.leadTime();
        if (leadTime.isOff()) {
            return;
        }
        Instant now = clock.instant();
        int reminded = 0;
        for (UUID bookingId : bookings.findDueForReminder(now, leadTime.hours())) {
            if (bookings.claimReminder(bookingId, now) == 1) {
                events.publishEvent(new BookingReminderDue(bookingId));
                reminded += 1;
            }
        }
        if (reminded > 0) {
            log.info("Reminded {} bookings starting within {} hours", reminded, leadTime.hours());
        }
    }
}
