package org.courtside.identity.internal;

import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.session.autoconfigure.SessionProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;

class CourtsideSessionConfigurationTest {

    private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
            .withUserConfiguration(SessionConfiguration.class)
            .withPropertyValues("spring.session.timeout=30m",
                    "courtside.session.absolute-lifetime=24h", "courtside.session.concurrent-limit=5",
                    "courtside.session.reauthentication-window=5m");

    @Test
    void givenValuesInsideTheirBounds_whenTheContextStarts_thenTheyBind() {
        // when / then
        contextRunner.run(context -> {
            CourtsideSessionProperties session = context.getBean(CourtsideSessionProperties.class);
            assertThat(session.absoluteLifetime()).isEqualTo(Duration.ofHours(24));
            assertThat(session.concurrentLimit()).isEqualTo(5);
            assertThat(session.reauthenticationWindow()).isEqualTo(Duration.ofMinutes(5));
        });
    }

    @Test
    void givenAReauthenticationWindowBeyondFiveMinutes_whenTheContextStarts_thenItRefusesToStart() {
        // given
        ApplicationContextRunner runner = contextRunner
                .withPropertyValues("courtside.session.reauthentication-window=6m");

        // when / then
        runner.run(context -> assertThat(context).getFailure().rootCause()
                .hasMessageContaining("reauthenticationWindow")
                .hasMessageContaining("PT6M"));
    }

    // A value this short ends a session inside the visit that opened it, which is a misconfiguration
    // rather than a strict setting, so the bound is what says so.
    @Test
    void givenALifetimeBelowTheFloor_whenTheContextStarts_thenItRefusesToStart() {
        // given
        ApplicationContextRunner runner = contextRunner
                .withPropertyValues("courtside.session.absolute-lifetime=30s");

        // when / then
        runner.run(context -> assertThat(context).getFailure().rootCause()
                .hasMessageContaining("absoluteLifetime")
                .hasMessageContaining("PT30S"));
    }

    @Test
    void givenALifetimeBeyondTheCeiling_whenTheContextStarts_thenItRefusesToStart() {
        // given — past this the bound guarantee is off in all but name, and deploy/README.md says so
        ApplicationContextRunner runner = contextRunner
                .withPropertyValues("courtside.session.absolute-lifetime=31d");

        // when / then
        runner.run(context -> assertThat(context).getFailure().rootCause()
                .hasMessageContaining("absoluteLifetime")
                .hasMessageContaining("PT744H"));
    }

    // The guard's own test constructs it directly, which proves the arithmetic and not that a
    // deployment ever meets it.
    @Test
    void givenALifetimeShorterThanTheInactivityWindow_whenTheContextStarts_thenItRefusesToStart() {
        // given
        ApplicationContextRunner runner = contextRunner
                .withPropertyValues("courtside.session.absolute-lifetime=29m");

        // when / then
        runner.run(context -> assertThat(context).getFailure().rootCause()
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("COURTSIDE_SESSION_ABSOLUTE_LIFETIME")
                .hasMessageContaining("COURTSIDE_SESSION_INACTIVITY_TIMEOUT"));
    }

    @Test
    void givenAnInactivityWindowThatNeverExpires_whenTheContextStarts_thenItRefusesToStart() {
        // given — the one value that switches the inactivity bound off without saying so
        ApplicationContextRunner runner = contextRunner
                .withPropertyValues("spring.session.timeout=-1s");

        // when / then
        runner.run(context -> assertThat(context).getFailure().rootCause()
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("COURTSIDE_SESSION_INACTIVITY_TIMEOUT"));
    }

    // Zero would refuse every sign-in, and a limit no account reaches is the policy switched off
    // while the variable still reads as if it were set.
    @Test
    void givenALimitBelowTheFloor_whenTheContextStarts_thenItRefusesToStart() {
        // given
        ApplicationContextRunner runner = contextRunner
                .withPropertyValues("courtside.session.concurrent-limit=0");

        // when / then
        runner.run(context -> assertThat(context).getFailure().rootCause()
                .hasMessageContaining("concurrentLimit"));
    }

    @Test
    void givenALimitBeyondTheCeiling_whenTheContextStarts_thenItRefusesToStart() {
        // given
        ApplicationContextRunner runner = contextRunner
                .withPropertyValues("courtside.session.concurrent-limit=51");

        // when / then
        runner.run(context -> assertThat(context).getFailure().rootCause()
                .hasMessageContaining("concurrentLimit"));
    }

    @Configuration(proxyBeanMethods = false)
    @EnableConfigurationProperties({SessionProperties.class, CourtsideSessionProperties.class})
    static class SessionConfiguration {

        @Bean
        SessionLifetimeGuard sessionLifetimeGuard(SessionProperties inactivity, CourtsideSessionProperties session) {
            return new SessionLifetimeGuard(inactivity, session);
        }
    }
}
