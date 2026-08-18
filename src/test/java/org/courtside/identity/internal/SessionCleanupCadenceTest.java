package org.courtside.identity.internal;

import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.session.jdbc.autoconfigure.JdbcSessionProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import static org.assertj.core.api.Assertions.assertThat;

class SessionCleanupCadenceTest {

    private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
            .withUserConfiguration(SessionCleanupConfiguration.class);

    @Test
    void givenACadence_whenTheContextStarts_thenTheCleanupKeepsIt() {
        // given
        ApplicationContextRunner runner = contextRunner.withPropertyValues(
                "spring.session.jdbc.cleanup-cron=0 */5 * * * *");

        // when / then
        runner.run(context -> assertThat(context.getBean(JdbcSessionProperties.class).getCleanupCron())
                .isEqualTo("0 */5 * * * *"));
    }

    // The bound property is what Spring Session reads, whichever variable set it, so the guard sits
    // there rather than on the one COURTSIDE_SESSION_CLEANUP_CRON happens to feed.
    @Test
    void givenTheCadenceSwitchesTheCleanupOff_whenTheContextStarts_thenItRefusesToStart() {
        // given
        ApplicationContextRunner runner = contextRunner.withPropertyValues(
                "spring.session.jdbc.cleanup-cron=-");

        // when / then
        runner.run(context -> assertThat(context).getFailure().rootCause()
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("spring.session.jdbc.cleanup-cron")
                .hasMessageContaining("switches the session cleanup off"));
    }

    @Configuration(proxyBeanMethods = false)
    @EnableConfigurationProperties(JdbcSessionProperties.class)
    static class SessionCleanupConfiguration {

        @Bean
        SessionCleanupCadence sessionCleanupCadence(JdbcSessionProperties properties) {
            return new SessionCleanupCadence(properties);
        }
    }
}
