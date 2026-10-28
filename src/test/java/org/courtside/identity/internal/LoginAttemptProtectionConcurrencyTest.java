package org.courtside.identity.internal;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.courtside.AbstractIntegrationTest;
import org.courtside.PostgresDiagnostics;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.TestPropertySource;

import java.time.Clock;
import java.time.Duration;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.stream.Stream;

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

    @Autowired
    private Clock clock;

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

    @Test
    void givenABlockedAddress_whenItsBlockIsRead_thenTheBlockIsReportedAndNothingIsCounted() {
        // given
        protection.registerAttempt("192.0.2.41");
        protection.registerAttempt("192.0.2.41");
        protection.registerAttempt("192.0.2.41");
        long before = attemptCount();

        // when
        Optional<LoginBlock> block = protection.loginBlock("192.0.2.41");
        Optional<LoginBlock> unblocked = protection.loginBlock("192.0.2.42");

        // then
        assertThat(block).as("a blocked address is told so by the read alone").isPresent();
        assertThat(unblocked).isEmpty();
        assertThat(attemptCount()).as("reading a block records no attempt").isEqualTo(before);
    }

    @Test
    void givenABlockedAnonymousSource_whenAnotherCredentialAttemptRegisters_thenItIsRefusedAndNotCounted() {
        // given
        assertThat(protection.registerAnonymousCredentialAttempt("192.0.2.50")).isEmpty();
        assertThat(protection.registerAnonymousCredentialAttempt("192.0.2.50")).isEmpty();
        long before = attemptCount();
        // when
        Optional<LoginBlock> block = protection.registerAnonymousCredentialAttempt("192.0.2.50");
        // then
        assertThat(block).map(LoginBlock::scope).contains("ADDRESS");
        assertThat(attemptCount()).as("a refused attempt is not counted again").isEqualTo(before);
    }

    @Test
    void givenAnExpiredBlockInsideTheSameWindow_whenTheAddressFailsAgain_thenItIsBlockedAgainAndTheControlIsReportedAgain() {
        // given
        protection.registerAttempt("192.0.2.51");
        protection.registerAttempt("192.0.2.51");
        jdbc.sql("UPDATE login_attempt_limit SET blocked_until = :past WHERE scope = 'ADDRESS' AND blocked_until IS NOT NULL")
                .param("past", clock.instant().minusSeconds(1).atOffset(ZoneOffset.UTC)).update();
        assertThat(protection.loginBlock("192.0.2.51")).isEmpty();
        // when
        List<String> reasons = controlReasons(() -> assertThat(protection.registerAttempt("192.0.2.51")).isEmpty());
        // then
        assertThat(protection.loginBlock("192.0.2.51")).as("the run continues within its window").isPresent();
        assertThat(reasons).as("a new block is a new control event").containsExactly("LOGIN_ADDRESS_LIMIT");
    }

    @Test
    void whenAttemptsWithoutAUsableAddressRegister_thenTheyShareOneBucketAndBlockTogether() {
        // when
        protection.registerAttempt(null);
        protection.registerAttempt("   ");
        // then
        assertThat(protection.loginBlock(null)).as("a missing address cannot escape the limit").isPresent();
        assertThat(protection.loginBlock("")).isPresent();
        assertThat(protection.loginBlock("192.0.2.52")).isEmpty();
    }

    private static List<String> controlReasons(Runnable action) {
        Logger log = (Logger) LoggerFactory.getLogger("org.courtside.security.events");
        ListAppender<ILoggingEvent> recorded = new ListAppender<>();
        recorded.start();
        log.addAppender(recorded);
        try {
            action.run();
        } finally {
            log.detachAppender(recorded);
        }
        return recorded.list.stream().flatMap(event -> event.getKeyValuePairs() == null ? Stream.empty()
                        : event.getKeyValuePairs().stream())
                .filter(pair -> pair.key.equals("event.reason")).map(pair -> String.valueOf(pair.value)).toList();
    }

    private long attemptCount() {
        return jdbc.sql("SELECT COALESCE(SUM(attempt_count), 0) FROM login_attempt_limit").query(Long.class).single();
    }
}
