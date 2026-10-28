package org.courtside.identity.internal;

import org.courtside.AbstractIntegrationTest;
import org.courtside.PostgresDiagnostics;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.InvalidDataAccessApiUsageException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.awaitility.Awaitility.await;

@Timeout(value = 90, unit = TimeUnit.SECONDS)
class MfaRecoveryCodeRepositoryTest extends AbstractIntegrationTest {
    @Autowired private MfaRecoveryCodeRepository codes;
    @Autowired private JdbcClient jdbc;
    @Autowired private PlatformTransactionManager transactions;

    @Test
    void givenANewRecoverySet_whenPersisting_thenOnlyVerifiersAreStoredAndEachCodeWorksOnce() {
        // given
        UUID account = account();
        List<String> plaintext = MfaRecoveryCodes.generate();
        // when
        codes.replace(account, plaintext);
        // then
        assertThat(codes.remaining(account)).isEqualTo(10);
        List<String> stored = jdbc.sql("SELECT code_hash FROM mfa_recovery_code WHERE account_id = :account")
                .param("account", account).query(String.class).list();
        assertThat(stored).containsExactlyInAnyOrderElementsOf(
                plaintext.stream().map(code -> MfaRecoveryCodes.verifier(code).orElseThrow()).toList());
        assertThat(stored).doesNotContainAnyElementsOf(plaintext);
        // when / then
        assertThat(codes.consume(account, plaintext.getFirst())).isTrue();
        assertThat(codes.consume(account, plaintext.getFirst())).isFalse();
        assertThat(codes.remaining(account)).isEqualTo(9);
    }

    @Test
    void givenAReplacedSet_whenRedeeming_thenOnlyTheNewCodesRemainValid() {
        // given
        UUID account = account();
        List<String> previous = MfaRecoveryCodes.generate();
        List<String> replacement = MfaRecoveryCodes.generate();
        codes.replace(account, previous);
        // when
        codes.replace(account, replacement);
        // then
        assertThat(codes.remaining(account)).isEqualTo(10);
        assertThat(codes.consume(account, previous.getFirst())).isFalse();
        assertThat(codes.consume(account, replacement.getFirst())).isTrue();
        assertThat(codes.remaining(account)).isEqualTo(9);
    }

    @Test
    void givenDifferentAccounts_whenRedeemingAnOthersCode_thenItsOwnerCanStillUseIt() {
        // given
        UUID owner = account();
        UUID other = account();
        List<String> plaintext = MfaRecoveryCodes.generate();
        codes.replace(owner, plaintext);
        // when / then
        assertThat(codes.consume(other, plaintext.getFirst())).isFalse();
        assertThat(codes.consume(owner, plaintext.getFirst())).isTrue();
        assertThat(codes.remaining(owner)).isEqualTo(9);
    }

    @Test
    void givenAnInvalidReplacement_whenPersistingFails_thenThePreviousCodesStillWork() {
        // given
        UUID account = account();
        List<String> previous = MfaRecoveryCodes.generate();
        codes.replace(account, previous);
        // when / then
        assertThatThrownBy(() -> codes.replace(account, List.of("malformed")))
                .isInstanceOf(InvalidDataAccessApiUsageException.class)
                .hasRootCauseInstanceOf(IllegalStateException.class)
                .hasMessage("Invalid MFA recovery code set");
        assertThat(codes.remaining(account)).isEqualTo(10);
        assertThat(codes.consume(account, previous.getFirst())).isTrue();
    }

    @Test
    void givenTwoConcurrentRedemptions_whenTheFirstHoldsTheDatabaseRow_thenOnlyOneCommitsSuccess() throws Exception {
        // given
        UUID account = account();
        String code = MfaRecoveryCodes.generate().getFirst();
        codes.replace(account, List.of(code));
        CountDownLatch started = new CountDownLatch(1);
        AtomicInteger waiter = new AtomicInteger();
        AtomicReference<Future<Boolean>> second = new AtomicReference<>();
        TransactionTemplate transaction = new TransactionTemplate(transactions);
        // when
        try (var executor = Executors.newSingleThreadExecutor()) {
            transaction.executeWithoutResult(status -> {
                assertThat(codes.consume(account, code)).isTrue();
                second.set(executor.submit(() -> transaction.execute(ignored -> {
                    waiter.set(jdbc.sql("SELECT pg_backend_pid()").query(Integer.class).single());
                    started.countDown();
                    return codes.consume(account, code);
                })));
                await().atMost(Duration.ofSeconds(20)).until(() -> started.getCount() == 0);
                await().atMost(Duration.ofSeconds(20)).until(() -> jdbc.sql("""
                                SELECT EXISTS (SELECT 1 FROM pg_stat_activity
                                    WHERE pid = :pid AND wait_event_type = 'Lock')
                                """).param("pid", waiter.get()).query(Boolean.class).single());
            });
            // then
            assertThat(PostgresDiagnostics.await(second.get(), Duration.ofSeconds(30), jdbc,
                    "The second MFA recovery redemption")).isFalse();
        }
        assertThat(codes.remaining(account)).isZero();
    }

    private UUID account() {
        UUID id = UUID.randomUUID();
        jdbc.sql("INSERT INTO person (id, first_name, last_name, email) VALUES (:id, 'Jane', 'Doe', :email)")
                .param("id", id).param("email", id + "@example.org").update();
        jdbc.sql("""
                        INSERT INTO user_account (id, person_id, username, locale, enabled, password_change_required)
                        VALUES (:id, :id, :username, 'en', true, true)
                        """).param("id", id).param("username", "mfa." + id).update();
        return id;
    }
}
