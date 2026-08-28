package org.courtside.booking.internal;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class BookingReminderScheduleTest {

    private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
            .withBean(BookingReminders.class, () -> mock(BookingReminders.class))
            .withUserConfiguration(BookingReminderSchedule.class);

    @Test
    void whenAnInstanceRuns_thenDueRemindersAreSweptOnACadence() {
        // when / then
        contextRunner.run(context -> assertThat(context).hasSingleBean(BookingReminderSchedule.class));
    }

    @Test
    void givenTheJourneyWorld_whenItStarts_thenNoSweepFallsDueBesideItsDatabaseReset() {
        // given
        ApplicationContextRunner runner = contextRunner
                .withPropertyValues("spring.profiles.active=journey");

        // when / then
        runner.run(context -> assertThat(context).doesNotHaveBean(BookingReminderSchedule.class));
    }
}
