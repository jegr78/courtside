package org.courtside.identity.internal;

import org.courtside.AbstractIntegrationTest;
import org.courtside.PostgresDiagnostics;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.locks.LockSupport;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

@Timeout(value = 90, unit = TimeUnit.SECONDS)
class PasswordResetRedemptionConcurrencyTest extends AbstractIntegrationTest {

    @Autowired
    private PasswordResetTokenService tokens;

    @Autowired
    private UserAccountRepository accounts;

    @MockitoBean
    private BreachedPasswordLookup breachedPasswords;

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

    @Test
    void givenACodeReplacedWhileItsRedemptionRuns_whenItCompletes_thenOnlyTheNewCodeIsLeft()
            throws Exception {
        // given — the breach lookup is where the seconds between reading a code and spending it go
        UUID account = account();
        String replaced = tokens.issueFor(account).code();
        CountDownLatch insideTheLookup = new CountDownLatch(1);
        CountDownLatch replacementCommitted = new CountDownLatch(1);
        when(breachedPasswords.isBreached(anyString())).thenAnswer(invocation -> {
            insideTheLookup.countDown();
            if (!replacementCommitted.await(20, TimeUnit.SECONDS)) {
                throw new IllegalStateException("The replacement never committed");
            }
            return false;
        });

        // when
        String fresh;
        Future<Boolean> older;
        try (ExecutorService executor = Executors.newSingleThreadExecutor()) {
            older = executor.submit(() -> redeemed(replaced, "a-password-nobody-guessed"));
            assertThat(insideTheLookup.await(20, TimeUnit.SECONDS))
                    .as("the redemption reached the lookup it is meant to sit in")
                    .isTrue();
            fresh = tokens.issueFor(account).code();
            replacementCommitted.countDown();
        }
        boolean olderSucceeded = PostgresDiagnostics.await(
                older, Duration.ofSeconds(30), jdbc, "The replaced redemption");

        // then
        assertThat(olderSucceeded)
                .as("a code a later request replaced must not set a password, nor take its "
                        + "replacement down with it")
                .isFalse();
        assertThat(passwordHashFor(account)).isNull();
        assertThat(codesFor(account))
                .as("the code the member was sent last is the one still outstanding")
                .isOne();
        tokens.redeem(fresh, "a-password-nobody-guessed");
        assertThat(passwordHashFor(account)).isNotNull();
    }

    @Test
    void givenADeactivationThatLandsMidRedemption_whenTheUpdateRuns_thenThePasswordIsNotReplaced()
            throws Exception {
        // given
        UUID account = account();
        String code = tokens.issueFor(account).code();

        // when — the account is withdrawn after the code was read and before the password is set
        Future<Boolean> redemption;
        try (ExecutorService executor = Executors.newSingleThreadExecutor()) {
            redemption = deactivateWhileItIsRedeemed(account, code, executor);
        }
        boolean redeemed = PostgresDiagnostics.await(
                redemption, Duration.ofSeconds(30), jdbc, "The withdrawn redemption");

        // then
        assertThat(redeemed)
                .as("a code the deactivation withdrew must not still set a password")
                .isFalse();
        assertThat(passwordHashFor(account)).isNull();
    }

    private Future<Boolean> deactivateWhileItIsRedeemed(UUID account, String code,
                                                        ExecutorService executor) {
        TransactionTemplate template = new TransactionTemplate(transactionManager);
        AtomicReference<Future<Boolean>> redemption = new AtomicReference<>();
        template.executeWithoutResult(status -> {
            UserAccount withdrawn = accounts.findById(account).orElseThrow();
            withdrawn.disable();
            accounts.saveAndFlush(withdrawn);
            redemption.set(executor.submit(() -> redeemed(code, "a-password-nobody-guessed")));
            awaitABackendBlockedByThisTransaction();
        });
        return redemption.get();
    }

    private Future<Boolean> redeemWhileTheFirstIsStillOpen(String code, ExecutorService executor) {
        TransactionTemplate template = new TransactionTemplate(transactionManager);
        AtomicReference<Future<Boolean>> second = new AtomicReference<>();
        template.executeWithoutResult(status -> {
            tokens.redeem(code, "a-password-nobody-guessed");
            second.set(executor.submit(() -> redeemed(code, "another-password-entirely")));
            awaitABackendBlockedByThisTransaction();
        });
        return second.get();
    }

    private void awaitABackendBlockedByThisTransaction() {
        Instant deadline = Instant.now().plus(Duration.ofSeconds(20));
        while (Instant.now().isBefore(deadline)) {
            if (blockedByThisTransaction() > 0) {
                return;
            }
            LockSupport.parkNanos(Duration.ofMillis(20).toNanos());
        }
        throw new AssertionError("Nothing ever blocked on this transaction. PostgreSQL: "
                + PostgresDiagnostics.waitsAndLocks(jdbc));
    }

    // Bound to the transaction this test holds open: another test's contention would otherwise
    // release the wait early and leave it measuring a missing row rather than a guard.
    private int blockedByThisTransaction() {
        return jdbc.sql("""
                        SELECT count(*) FROM pg_stat_activity
                        WHERE pid <> pg_backend_pid()
                          AND pg_backend_pid() = ANY(pg_blocking_pids(pid))
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
                .param("id", accountId)
                .query((result, row) -> result.getString("password_hash"))
                .optional()
                .orElse(null);
    }
}
