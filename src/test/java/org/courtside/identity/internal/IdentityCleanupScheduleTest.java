package org.courtside.identity.internal;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class IdentityCleanupScheduleTest {

    private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
            .withBean(CredentialIssueLimit.class, () -> mock(CredentialIssueLimit.class))
            .withBean(LoginAttemptCleanup.class, () -> mock(LoginAttemptCleanup.class))
            .withUserConfiguration(IdentityCleanupSchedule.class);

    @Test
    void whenAnInstanceRuns_thenExpiredCredentialWindowsAndLoginAttemptsAreSweptOnACadence() {
        // when / then
        contextRunner.run(context -> assertThat(context).hasSingleBean(IdentityCleanupSchedule.class));
    }

    // The journey world resets the database underneath a live application, and a sweep landing in
    // the middle of that reset deadlocks against it.
    @Test
    void givenTheJourneyWorld_whenItStarts_thenNoSweepFallsDueBesideItsDatabaseReset() {
        // given
        ApplicationContextRunner runner = contextRunner
                .withPropertyValues("spring.profiles.active=journey");

        // when / then
        runner.run(context -> assertThat(context).doesNotHaveBean(IdentityCleanupSchedule.class));
    }
}
