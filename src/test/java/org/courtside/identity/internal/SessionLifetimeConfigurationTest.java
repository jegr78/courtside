package org.courtside.identity.internal;

import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.session.autoconfigure.SessionProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;

class SessionLifetimeConfigurationTest {

    private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
            .withUserConfiguration(SessionLifetimeConfiguration.class)
            .withPropertyValues("spring.session.timeout=30m");

    @Test
    void givenALifetimeInsideItsBounds_whenTheContextStarts_thenItBinds() {
        // given
        ApplicationContextRunner runner = contextRunner
                .withPropertyValues("courtside.session.absolute-lifetime=24h");

        // when / then
        runner.run(context -> assertThat(context.getBean(SessionLifetimeProperties.class).absoluteLifetime())
                .isEqualTo(Duration.ofHours(24)));
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

    @Configuration(proxyBeanMethods = false)
    @EnableConfigurationProperties({SessionProperties.class, SessionLifetimeProperties.class})
    static class SessionLifetimeConfiguration {

        @Bean
        SessionLifetimeGuard sessionLifetimeGuard(SessionProperties inactivity, SessionLifetimeProperties lifetime) {
            return new SessionLifetimeGuard(inactivity, lifetime);
        }
    }
}
