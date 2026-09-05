package org.courtside.identity.internal;

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
        "courtside.login-protection.address.max-failures=2",
        "courtside.login-protection.global.threshold=20"
})
@Timeout(value = 30, unit = TimeUnit.SECONDS)
class LoginAttemptProtectionConcurrencyTest extends AbstractIntegrationTest {

    @Autowired
    private LoginAttemptProtection protection;

    @Autowired
    private JdbcClient jdbc;

    @Test
    void givenConcurrentAttemptsFromOneAddress_whenTheyRegister_thenTheLimitIsAtomic()
            throws Exception {
        // given
        List<Callable<Optional<LoginBlock>>> attempts = List.of(
                () -> protection.registerAttempt("192.0.2.40"),
                () -> protection.registerAttempt("192.0.2.40"),
                () -> protection.registerAttempt("192.0.2.40"));

        // when
        List<Optional<LoginBlock>> results;
        try (var executor = Executors.newFixedThreadPool(3)) {
            results = attempts.stream().map(executor::submit).map(future -> {
                try {
                    return PostgresDiagnostics.await(
                            future, Duration.ofSeconds(20), jdbc, "Concurrent login attempt");
                } catch (Exception exception) {
                    throw new IllegalStateException("Concurrent attempt failed", exception);
                }
            }).toList();
        }

        // then
        assertThat(results).filteredOn(Optional::isPresent).hasSize(1);
    }
}
