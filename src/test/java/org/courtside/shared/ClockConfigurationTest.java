package org.courtside.shared;

import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.autoconfigure.context.PropertyPlaceholderAutoConfiguration;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import java.time.Clock;
import java.time.Instant;
import java.time.format.DateTimeParseException;

import static org.assertj.core.api.Assertions.assertThat;

class ClockConfigurationTest {

    private static final String FIXED_INSTANT = "2026-05-12T10:00:00Z";

    private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
            .withConfiguration(AutoConfigurations.of(PropertyPlaceholderAutoConfiguration.class))
            .withUserConfiguration(ClockConfiguration.class);

    @Test
    void givenNoFixedInstant_whenTheContextStarts_thenTheClockFollowsTheSystem() {
        // given
        ApplicationContextRunner runner = contextRunner.withPropertyValues("courtside.environment=PRODUCTION");

        // when / then
        runner.run(context -> assertThat(context.getBean(Clock.class)).isEqualTo(Clock.systemUTC()));
    }

    @Test
    void givenABlankFixedInstant_whenTheContextStarts_thenTheClockFollowsTheSystem() {
        // given
        ApplicationContextRunner runner = contextRunner.withPropertyValues(
                "courtside.environment=DEVELOPMENT", "courtside.clock.fixed-instant=");

        // when / then
        runner.run(context -> assertThat(context.getBean(Clock.class)).isEqualTo(Clock.systemUTC()));
    }

    @Test
    void givenANonProductionInstance_whenAFixedInstantIsConfigured_thenTheClockStandsStill() {
        // given
        ApplicationContextRunner runner = contextRunner.withPropertyValues(
                "courtside.environment=DEVELOPMENT", "courtside.clock.fixed-instant=" + FIXED_INSTANT);

        // when / then
        runner.run(context -> assertThat(context.getBean(Clock.class).instant())
                .isEqualTo(Instant.parse(FIXED_INSTANT)));
    }

    @Test
    void givenAProductionInstance_whenAFixedInstantIsConfigured_thenTheContextRefusesToStart() {
        // given
        ApplicationContextRunner runner = contextRunner.withPropertyValues(
                "courtside.environment=PRODUCTION", "courtside.clock.fixed-instant=" + FIXED_INSTANT);

        // when / then
        runner.run(context -> assertThat(context).getFailure().rootCause()
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("A fixed clock requires courtside.environment")
                .hasMessageContaining("PRODUCTION"));
    }

    @Test
    void givenNoEnvironmentDesignation_whenAFixedInstantIsConfigured_thenTheContextRefusesToStart() {
        // given
        ApplicationContextRunner runner = contextRunner.withPropertyValues(
                "courtside.clock.fixed-instant=" + FIXED_INSTANT);

        // when / then
        runner.run(context -> assertThat(context).getFailure().rootCause()
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("A fixed clock requires courtside.environment"));
    }

    @Test
    void givenAPerformanceInstance_whenAFixedInstantIsConfigured_thenTheClockStandsStill() {
        // given
        ApplicationContextRunner runner = contextRunner.withPropertyValues(
                "courtside.environment=PERFORMANCE", "courtside.clock.fixed-instant=" + FIXED_INSTANT);

        // when / then
        runner.run(context -> assertThat(context.getBean(Clock.class).instant())
                .isEqualTo(Instant.parse(FIXED_INSTANT)));
    }

    @Test
    void givenAMisspelledDesignation_whenAFixedInstantIsConfigured_thenTheContextRefusesToStart() {
        // given
        ApplicationContextRunner runner = contextRunner.withPropertyValues(
                "courtside.environment=PRODUCTIO", "courtside.clock.fixed-instant=" + FIXED_INSTANT);

        // when / then
        runner.run(context -> assertThat(context).getFailure().rootCause()
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("A fixed clock requires courtside.environment")
                .hasMessageContaining("PRODUCTIO"));
    }

    @Test
    void givenAnUnparseableFixedInstant_whenTheContextStarts_thenItRefusesWithTheExpectedFormat() {
        // given
        ApplicationContextRunner runner = contextRunner.withPropertyValues(
                "courtside.environment=DEVELOPMENT", "courtside.clock.fixed-instant=2026-05-12");

        // when / then
        runner.run(context -> assertThat(context).getFailure()
                .hasRootCauseInstanceOf(DateTimeParseException.class)
                .hasStackTraceContaining("courtside.clock.fixed-instant must be an ISO-8601 instant"));
    }
}
