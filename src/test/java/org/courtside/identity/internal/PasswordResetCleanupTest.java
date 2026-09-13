package org.courtside.identity.internal;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.TestPropertySource;

import java.time.Clock;
import java.time.Duration;
import java.time.ZoneOffset;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@TestPropertySource(properties = {"courtside.password-reset-mail.max-per-window=2",
        "courtside.password-reset-mail.window=1h",
        "courtside.password-reset-mail.retention=24h"})
class PasswordResetCleanupTest extends AbstractIntegrationTest {

    @Autowired
    private PasswordResetTokenService tokens;

    @Autowired
    private PasswordResetMailLimit mailLimit;

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private Clock clock;

    @Test
    void givenCodesOnBothSidesOfTheirDeadline_whenTheSweepRuns_thenOnlyTheExpiredOneIsGone() {
        // given
        UUID expired = accountWithCodeExpiring(Duration.ofHours(-1));
        UUID live = accountWithCodeExpiring(Duration.ofHours(1));

        // when
        tokens.deleteExpired();

        // then — a code still inside its window is one a member may be holding
        assertThat(codesFor(expired)).isZero();
        assertThat(codesFor(live)).isOne();
    }

    @Test
    void givenMailWindowsOnBothSidesOfTheRetention_whenTheSweepRuns_thenOnlyTheOutlivedOneIsGone() {
        // given
        UUID outlived = accountWithMailWindowStarted(Duration.ofHours(48));
        UUID recent = accountWithMailWindowStarted(Duration.ofMinutes(30));

        // when
        mailLimit.deleteExpiredWindows();

        // then — a row still inside its retention carries a count that must keep binding
        assertThat(mailWindowsFor(outlived)).isZero();
        assertThat(mailWindowsFor(recent)).isOne();
    }

    @Test
    void givenAMailWindowThatHasRunOut_whenTheNextRequestArrives_thenTheBudgetStartsOver() {
        // given
        UUID account = accountWithMailWindowStarted(Duration.ofHours(2));
        jdbc.sql("UPDATE password_reset_mail_limit SET mailed_count = 2 WHERE account_id = :id")
                .param("id", account).update();

        // when
        boolean admitted = mailLimit.recordWithinWindow(account);

        // then — a window the sweep has not reached yet must still stop binding once it is over
        assertThat(admitted).isTrue();
        assertThat(countedFor(account)).isOne();
        assertThat(mailLimit.recordWithinWindow(account)).isTrue();
        assertThat(mailLimit.recordWithinWindow(account))
                .as("the fresh window holds the configured budget and no more")
                .isFalse();
    }

    private UUID accountWithCodeExpiring(Duration fromNow) {
        UUID accountId = account();
        jdbc.sql("""
                        INSERT INTO password_reset_token (account_id, code_hash, address_hash,
                            security_epoch, created_at, expires_at)
                        VALUES (:id, :codeHash, :addressHash, 0, :createdAt, :expiresAt)
                        """)
                .param("id", accountId)
                .param("codeHash", ResetCodes.fingerprint(accountId.toString()))
                .param("addressHash", ResetCodes.fingerprintOfAddress(accountId + "@example.org"))
                .param("createdAt", clock.instant().minus(Duration.ofHours(2)).atOffset(ZoneOffset.UTC))
                .param("expiresAt", clock.instant().plus(fromNow).atOffset(ZoneOffset.UTC))
                .update();
        return accountId;
    }

    private UUID accountWithMailWindowStarted(Duration ago) {
        UUID accountId = account();
        jdbc.sql("""
                        INSERT INTO password_reset_mail_limit (account_id, mailed_count,
                            window_started_at)
                        VALUES (:id, 1, :startedAt)
                        """)
                .param("id", accountId)
                .param("startedAt", clock.instant().minus(ago).atOffset(ZoneOffset.UTC))
                .update();
        return accountId;
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

    private int mailWindowsFor(UUID accountId) {
        return jdbc.sql("SELECT count(*) FROM password_reset_mail_limit WHERE account_id = :id")
                .param("id", accountId).query(Integer.class).single();
    }

    private int countedFor(UUID accountId) {
        return jdbc.sql("SELECT mailed_count FROM password_reset_mail_limit WHERE account_id = :id")
                .param("id", accountId).query(Integer.class).single();
    }
}
