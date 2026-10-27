package org.courtside.identity.internal;

import org.courtside.AbstractIntegrationTest;
import org.courtside.PostgresDiagnostics;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Clock;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

@Timeout(value = 90, unit = TimeUnit.SECONDS)
class MfaProofConcurrencyTest extends AbstractIntegrationTest {
    @Autowired private MfaFactors factors;
    @Autowired private MfaTotpRepository totp;
    @Autowired private JdbcClient jdbc;
    @Autowired private Clock clock;
    @Autowired private PlatformTransactionManager transactions;

    @Test
    void givenAnAccountLockedByLogin_whenReauthenticationCompetes_thenBothUseTheSameLockOrderAndOnlyOneCodeSucceeds() throws Exception {
        // given
        UUID account = account();
        byte[] secret = totp.begin(account);
        assertThat(totp.confirm(account, TotpCodes.code(secret, clock.instant().minusSeconds(30)))).isTrue();
        String code = TotpCodes.code(secret, clock.instant());
        TransactionTemplate transaction = new TransactionTemplate(transactions);
        AtomicInteger waiter = new AtomicInteger();
        AtomicReference<Future<MfaFactors.Verification>> competing = new AtomicReference<>();
        // when
        try (var executor = Executors.newSingleThreadExecutor()) {
            transaction.executeWithoutResult(status -> {
                jdbc.sql("SELECT id FROM user_account WHERE id = :id FOR UPDATE")
                        .param("id", account).query(UUID.class).single();
                competing.set(executor.submit(() -> transaction.execute(ignored -> {
                    waiter.set(jdbc.sql("SELECT pg_backend_pid()").query(Integer.class).single());
                    return factors.verify(account, code, "192.0.2.10");
                })));
                await().atMost(Duration.ofSeconds(20)).until(() -> waiter.get() > 0);
                await().atMost(Duration.ofSeconds(20)).until(() -> jdbc.sql("""
                        SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid = :pid AND wait_event_type = 'Lock')
                        """).param("pid", waiter.get()).query(Boolean.class).single());
                assertThat(factors.verify(account, code, "192.0.2.11")).isEqualTo(MfaFactors.Verification.VALID);
            });
            // then
            assertThat(PostgresDiagnostics.await(competing.get(), Duration.ofSeconds(30), jdbc,
                    "The competing MFA proof")).isEqualTo(MfaFactors.Verification.INVALID);
        }
    }

    private UUID account() {
        UUID id = UUID.randomUUID();
        jdbc.sql("INSERT INTO person (id, first_name, last_name, email) VALUES (:id, 'Jane', 'Doe', :email)")
                .param("id", id).param("email", id + "@example.org").update();
        jdbc.sql("""
                INSERT INTO user_account (id, person_id, username, locale, enabled, password_change_required)
                VALUES (:id, :id, :username, 'en', true, false)
                """).param("id", id).param("username", "mfa." + id).update();
        return id;
    }
}
