package org.courtside.booking.internal;

import org.junit.jupiter.api.Test;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

class BookingReminderScheduleTest {

    @Test
    void whenTheScheduleRuns_thenDueBookingRemindersAreProcessed() {
        // given
        BookingReminders reminders = mock(BookingReminders.class);
        BookingReminderSchedule schedule = new BookingReminderSchedule(reminders);

        // when
        schedule.remindWhatIsDue();

        // then
        verify(reminders).remindWhatIsDue();
    }
}
