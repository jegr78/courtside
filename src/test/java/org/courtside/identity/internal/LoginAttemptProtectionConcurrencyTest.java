package org.courtside.identity.internal;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;

import java.time.Duration;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;

import static org.assertj.core.api.Assertions.assertThat;

@TestPropertySource(properties = {
        "courtside.login-protection.address.max-failures=2",
        "courtside.login-protection.global.max-failures=20"
})
class LoginAttemptProtectionConcurrencyTest extends AbstractIntegrationTest {

    @Autowired
    private LoginAttemptProtection protection;

    @Test
    void givenConcurrentAttemptsFromOneAddress_whenTheyRegister_thenTheLimitIsAtomic()
            throws Exception {
        // given
        List<Callable<Optional<Duration>>> attempts = List.of(
                () -> protection.registerAttempt("192.0.2.40"),
                () -> protection.registerAttempt("192.0.2.40"),
                () -> protection.registerAttempt("192.0.2.40"));

        // when
        List<Optional<Duration>> results;
        try (var executor = Executors.newFixedThreadPool(3)) {
            results = executor.invokeAll(attempts).stream().map(future -> {
                try {
                    return future.get();
                } catch (Exception exception) {
                    throw new IllegalStateException("Concurrent attempt failed", exception);
                }
            }).toList();
        }

        // then
        assertThat(results).filteredOn(Optional::isPresent).hasSize(1);
    }
}
