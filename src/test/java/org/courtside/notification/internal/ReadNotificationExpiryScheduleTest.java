package org.courtside.notification.internal;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class ReadNotificationExpiryScheduleTest {

    private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
            .withBean(ReadNotificationExpiry.class, () -> mock(ReadNotificationExpiry.class))
            .withUserConfiguration(ReadNotificationExpirySchedule.class);

    @Test
    void whenAnInstanceRuns_thenReadNotificationsAreExpiredOnACadence() {
        // when / then
        contextRunner.run(context -> assertThat(context).hasSingleBean(ReadNotificationExpirySchedule.class));
    }

    @Test
    void givenTheJourneyWorld_whenItStarts_thenNoExpiryFallsDueBesideItsDatabaseReset() {
        // given
        ApplicationContextRunner runner = contextRunner.withPropertyValues("spring.profiles.active=journey");

        // when / then
        runner.run(context -> assertThat(context).doesNotHaveBean(ReadNotificationExpirySchedule.class));
    }
}
