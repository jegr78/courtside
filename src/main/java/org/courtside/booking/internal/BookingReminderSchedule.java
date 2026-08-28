package org.courtside.booking.internal;

import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Profile;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.concurrent.TimeUnit;

@Component
@Profile("!journey")
@RequiredArgsConstructor
class BookingReminderSchedule {

    private final BookingReminders reminders;

    @Scheduled(initialDelay = 1, timeUnit = TimeUnit.MINUTES,
            fixedDelayString = "${courtside.booking.reminder-sweep-interval}")
    void remindWhatIsDue() {
        reminders.remindWhatIsDue();
    }
}
