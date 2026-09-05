package org.courtside.identity.internal;

import io.micrometer.core.instrument.MeterRegistry;
import org.courtside.AbstractIntegrationTest;
import org.courtside.PostgresDiagnostics;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.TestPropertySource;

import java.time.Duration;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

@TestPropertySource(properties = {
        "courtside.login-protection.address.max-failures=100",
        "courtside.login-protection.global.threshold=2"
})
@Timeout(value = 30, unit = TimeUnit.SECONDS)
class GlobalLoginObservationConcurrencyTest extends AbstractIntegrationTest {

    @Autowired
    private LoginAttemptProtection protection;

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private MeterRegistry meters;

    @Test
    void givenConcurrentDistributedAttempts_whenTheThresholdIsCrossed_thenEveryAttemptContinues()
            throws Exception {
        // given
        double observationsBefore = meters.counter("courtside.login.distributed.thresholds").count();
        List<Callable<Optional<LoginBlock>>> attempts = java.util.stream.IntStream.range(0, 12)
                .mapToObj(index -> (Callable<Optional<LoginBlock>>) () ->
                        protection.registerAttempt("192.0.2." + (100 + index)))
                .toList();

        // when
        List<Optional<LoginBlock>> results;
        try (var executor = Executors.newFixedThreadPool(12)) {
            results = attempts.stream().map(executor::submit).map(future -> {
                try {
                    return PostgresDiagnostics.await(
                            future, Duration.ofSeconds(20), jdbc, "Distributed login observation");
                } catch (Exception exception) {
                    throw new IllegalStateException("Concurrent observation failed", exception);
                }
            }).toList();
        }

        // then
        assertThat(results).allMatch(Optional::isEmpty);
        assertThat(jdbc.sql("SELECT attempt_count FROM login_attempt_limit WHERE scope = 'GLOBAL'")
                .query(Integer.class).single()).isEqualTo(12);
        assertThat(meters.counter("courtside.login.distributed.thresholds").count())
                .isEqualTo(observationsBefore + 1);
    }
}
