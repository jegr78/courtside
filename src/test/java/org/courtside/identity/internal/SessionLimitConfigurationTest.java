package org.courtside.identity.internal;

import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Configuration;

import static org.assertj.core.api.Assertions.assertThat;

class SessionLimitConfigurationTest {

    private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
            .withUserConfiguration(SessionLimitConfiguration.class)
            .withPropertyValues("courtside.session.absolute-lifetime=24h");

    @Test
    void givenALimitInsideItsBounds_whenTheContextStarts_thenItBinds() {
        // given
        ApplicationContextRunner runner = contextRunner
                .withPropertyValues("courtside.session.concurrent-limit=5");

        // when / then
        runner.run(context -> assertThat(context.getBean(CourtsideSessionProperties.class).concurrentLimit())
                .isEqualTo(5));
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
    @EnableConfigurationProperties(CourtsideSessionProperties.class)
    static class SessionLimitConfiguration {
    }
}
