package org.courtside.dataexchange.internal;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class PreviewExpiryScheduleTest {

    private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
            .withBean(PreviewExpiry.class, () -> mock(PreviewExpiry.class))
            .withUserConfiguration(PreviewExpirySchedule.class);

    @Test
    void whenAnInstanceRuns_thenPreviewsPastTheirRetentionAreSweptOnACadence() {
        // when / then
        contextRunner.run(context -> assertThat(context).hasSingleBean(PreviewExpirySchedule.class));
    }

    @Test
    void givenTheJourneyWorld_whenItStarts_thenNoSweepFallsDueBesideItsDatabaseReset() {
        // given
        ApplicationContextRunner runner = contextRunner
                .withPropertyValues("spring.profiles.active=journey");

        // when / then
        runner.run(context -> assertThat(context).doesNotHaveBean(PreviewExpirySchedule.class));
    }
}
