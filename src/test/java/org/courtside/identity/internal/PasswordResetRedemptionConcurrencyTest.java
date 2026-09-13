package org.courtside.identity.internal;

import org.courtside.AbstractIntegrationTest;
import org.courtside.PostgresDiagnostics;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.time.Duration;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

@Timeout(value = 60, unit = TimeUnit.SECONDS)
class PasswordResetRedemptionConcurrencyTest extends AbstractIntegrationTest {

    @Autowired
    private PasswordResetTokenService tokens;

    @Autowired
    private JdbcClient jdbc;

    @Test
    void givenOneCodeAndTwoRedemptionsAtOnce_whenTheyRun_thenOnlyOneOfThemSetsAPassword() {
        // given
        UUID account = account();
        String code = tokens.issueFor(account).code();

        // when
        List<Callable<Boolean>> redemptions = List.of(
                () -> redeemed(code, "a-password-nobody-guessed"),
                () -> redeemed(code, "another-password-entirely"));
        List<Boolean> outcomes;
        try (var executor = Executors.newFixedThreadPool(2)) {
            outcomes = redemptions.stream().map(executor::submit).map(future -> {
                try {
                    return PostgresDiagnostics.await(future, Duration.ofSeconds(30), jdbc,
                            "Concurrent redemption");
                } catch (Exception exception) {
                    throw new IllegalStateException("Concurrent redemption failed", exception);
                }
            }).toList();
        }

        // then
        assertThat(outcomes)
                .as("a code spent twice at once would set a password its holder never chose")
                .containsExactlyInAnyOrder(true, false);
        assertThat(codesFor(account)).isZero();
        assertThat(passwordHashFor(account)).isNotNull();
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
