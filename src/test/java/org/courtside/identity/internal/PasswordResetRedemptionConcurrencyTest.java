package org.courtside.identity.internal;

import org.courtside.AbstractIntegrationTest;
import org.courtside.PostgresDiagnostics;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

@Timeout(value = 90, unit = TimeUnit.SECONDS)
class PasswordResetRedemptionConcurrencyTest extends AbstractIntegrationTest {

    @Autowired
    private PasswordResetTokenService tokens;

    @Autowired
    private PlatformTransactionManager transactionManager;

    @Autowired
    private JdbcClient jdbc;

    @Test
    void givenTwoRedemptionsInsideOneAnothersWindow_whenTheyRun_thenOnlyTheFirstSetsAPassword()
            throws Exception {
        // given
        UUID account = account();
        String code = tokens.issueFor(account).code();

        // when — the second reads the row and reaches the delete while the first still holds it
        Future<Boolean> second;
        try (ExecutorService executor = Executors.newSingleThreadExecutor()) {
            second = redeemWhileTheFirstIsStillOpen(code, executor);
        }
        boolean secondSucceeded = PostgresDiagnostics.await(
                second, Duration.ofSeconds(30), jdbc, "The second redemption");

        // then
        assertThat(secondSucceeded)
                .as("a code spent twice inside one window would set a password nobody was sent")
                .isFalse();
        assertThat(codesFor(account)).isZero();
        assertThat(passwordHashFor(account)).isNotNull();
    }

    private Future<Boolean> redeemWhileTheFirstIsStillOpen(String code, ExecutorService executor) {
        TransactionTemplate template = new TransactionTemplate(transactionManager);
        AtomicReference<Future<Boolean>> second = new AtomicReference<>();
        template.executeWithoutResult(status -> {
            tokens.redeem(code, "a-password-nobody-guessed");
            second.set(executor.submit(() -> redeemed(code, "another-password-entirely")));
            awaitTheSecondBlockingOnTheRow();
        });
        return second.get();
    }

    private void awaitTheSecondBlockingOnTheRow() {
        Instant deadline = Instant.now().plus(Duration.ofSeconds(20));
        while (Instant.now().isBefore(deadline)) {
            if (blockedBackends() > 0) {
                return;
            }
            Thread.onSpinWait();
        }
        throw new AssertionError("The second redemption never reached the token row. PostgreSQL: "
                + PostgresDiagnostics.waitsAndLocks(jdbc));
    }

    private int blockedBackends() {
        return jdbc.sql("""
                        SELECT count(*) FROM pg_locks
                        WHERE NOT granted AND pid <> pg_backend_pid()
                        """)
                .query(Integer.class).single();
    }

    private boolean redeemed(String code, String password) {
        try {
            tokens.redeem(code, password);
            return true;
        } catch (ResetCodeInvalidException refused) {
            return false;
        }
    }

    private UUID account() {
        UUID accountId = UUID.randomUUID();
        jdbc.sql("""
                        INSERT INTO person (id, first_name, last_name, email)
                        VALUES (:id, 'Jane', 'Doe', :email)
                        """)
                .param("id", accountId).param("email", accountId + "@example.org").update();
        jdbc.sql("""
                        INSERT INTO user_account (id, person_id, username, locale, enabled,
                            password_change_required)
                        VALUES (:id, :id, :username, 'de', true, true)
                        """)
                .param("id", accountId).param("username", "doe." + accountId).update();
        return accountId;
    }

    private int codesFor(UUID accountId) {
        return jdbc.sql("SELECT count(*) FROM password_reset_token WHERE account_id = :id")
                .param("id", accountId).query(Integer.class).single();
    }

    private String passwordHashFor(UUID accountId) {
        return jdbc.sql("SELECT password_hash FROM user_account WHERE id = :id")
                .param("id", accountId).query(String.class).single();
    }
}
