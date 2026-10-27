package org.courtside.identity.internal;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.TestPropertySource;

import java.time.Clock;
import java.time.ZoneOffset;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@TestPropertySource(properties = "courtside.session.concurrent-limit=2")
class MfaChallengesTest extends AbstractIntegrationTest {
    @Autowired private MfaChallenges challenges;
    @Autowired private JdbcClient jdbc;
    @Autowired private Clock clock;

    @Test
    void givenABoundChallenge_whenAttemptingAndCompleting_thenItPreservesOptionsAndWorksOnce() {
        // given
        UUID account = account();
        UUID id = challenges.issue(account, 0, MfaChallenges.Purpose.LOGIN, "browser-session", "options").orElseThrow();
        // when
        var challenge = challenges.attempt(id, account, 0, MfaChallenges.Purpose.LOGIN, "browser-session");
        // then
        assertThat(challenge).contains(new MfaChallenges.Challenge(id, "options"));
        assertThat(challenges.consume(id)).isTrue();
        assertThat(challenges.consume(id)).isFalse();
        assertThat(challenges.attempt(id, account, 0, MfaChallenges.Purpose.LOGIN, "browser-session")).isEmpty();
        assertThat(jdbc.sql("SELECT count(*) FROM mfa_challenge WHERE session_hash = 'browser-session'")
                .query(Integer.class).single()).isZero();
    }

    @Test
    void givenAChallenge_whenItsBindingsDiffer_thenItCannotBeUsedAcrossAccountsSessionsEpochsOrPurposes() {
        // given
        UUID account = account();
        UUID other = account();
        UUID id = challenges.issue(account, 0, MfaChallenges.Purpose.LOGIN, "one", "options").orElseThrow();
        // when / then
        assertThat(challenges.attempt(id, other, 0, MfaChallenges.Purpose.LOGIN, "one")).isEmpty();
        assertThat(challenges.attempt(id, account, 0, MfaChallenges.Purpose.LOGIN, "two")).isEmpty();
        assertThat(challenges.attempt(id, account, 1, MfaChallenges.Purpose.LOGIN, "one")).isEmpty();
        assertThat(challenges.attempt(id, account, 0, MfaChallenges.Purpose.REAUTHENTICATION, "one")).isEmpty();
        assertThat(challenges.attempt(id, account, 0, MfaChallenges.Purpose.LOGIN, "one")).isPresent();
    }

    @Test
    void givenAnExpiredOrExhaustedChallenge_whenAttempting_thenItIsRefused() {
        // given
        UUID account = account();
        UUID id = challenges.issue(account, 0, MfaChallenges.Purpose.LOGIN, "one", "").orElseThrow();
        // when / then
        for (int attempt = 0; attempt < 5; attempt++) {
            assertThat(challenges.attempt(id, account, 0, MfaChallenges.Purpose.LOGIN, "one")).isPresent();
        }
        assertThat(challenges.attempt(id, account, 0, MfaChallenges.Purpose.LOGIN, "one")).isEmpty();
        UUID expired = challenges.issue(account, 0, MfaChallenges.Purpose.LOGIN, "two", "").orElseThrow();
        jdbc.sql("UPDATE mfa_challenge SET expires_at = :now WHERE id = :id")
                .param("id", expired).param("now", clock.instant().atOffset(ZoneOffset.UTC)).update();
        assertThat(challenges.attempt(expired, account, 0, MfaChallenges.Purpose.LOGIN, "two")).isEmpty();
    }

    @Test
    void givenRevokedOrDisabledAccounts_whenIssuingOrUsingChallenges_thenAuthenticationCannotProceed() {
        // given
        UUID account = account();
        UUID id = challenges.issue(account, 0, MfaChallenges.Purpose.LOGIN, "one", "").orElseThrow();
        // when
        jdbc.sql("UPDATE user_account SET security_epoch = 1 WHERE id = :id").param("id", account).update();
        // then
        assertThat(challenges.attempt(id, account, 0, MfaChallenges.Purpose.LOGIN, "one")).isEmpty();
        assertThat(challenges.issue(account, 0, MfaChallenges.Purpose.LOGIN, "one", "")).isEmpty();
        // when
        jdbc.sql("UPDATE user_account SET enabled = false WHERE id = :id").param("id", account).update();
        // then
        assertThat(challenges.issue(account, 1, MfaChallenges.Purpose.LOGIN, "one", "")).isEmpty();
    }

    @Test
    void givenAPreviousChallenge_whenRestartingInTheSameBrowser_thenOnlyTheNewChallengeRemainsValid() {
        // given
        UUID account = account();
        UUID old = challenges.issue(account, 0, MfaChallenges.Purpose.LOGIN, "one", "").orElseThrow();
        // when
        UUID replacement = challenges.issue(account, 0, MfaChallenges.Purpose.LOGIN, "one", "").orElseThrow();
        // then
        assertThat(challenges.attempt(old, account, 0, MfaChallenges.Purpose.LOGIN, "one")).isEmpty();
        assertThat(challenges.attempt(replacement, account, 0, MfaChallenges.Purpose.LOGIN, "one")).isPresent();
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

    @Test
    void givenAPasswordChallenge_whenIssuingNewWebAuthnOptions_thenItsOriginalExpiryAndAttemptBudgetCannotBeRenewed() {
        // given
        UUID account = account();
        UUID id = challenges.issue(account, 0, MfaChallenges.Purpose.LOGIN, "one", "").orElseThrow();
        var originalExpiry = jdbc.sql("SELECT expires_at FROM mfa_challenge WHERE id = :id").param("id", id)
                .query(java.time.OffsetDateTime.class).single();
        // when / then
        assertThat(challenges.setPayload(id, account, 0, MfaChallenges.Purpose.LOGIN, "one", "first-options")).isTrue();
        assertThat(challenges.setPayload(id, account, 0, MfaChallenges.Purpose.LOGIN, "other", "foreign-options")).isFalse();
        assertThat(challenges.attempt(id, account, 0, MfaChallenges.Purpose.LOGIN, "one"))
                .contains(new MfaChallenges.Challenge(id, "first-options"));
        assertThat(challenges.setPayload(id, account, 0, MfaChallenges.Purpose.LOGIN, "one", "new-options")).isTrue();
        assertThat(jdbc.sql("SELECT expires_at FROM mfa_challenge WHERE id = :id").param("id", id)
                .query(java.time.OffsetDateTime.class).single()).isEqualTo(originalExpiry);
        assertThat(jdbc.sql("SELECT attempt_count FROM mfa_challenge WHERE id = :id").param("id", id)
                .query(Integer.class).single()).isEqualTo(1);
        // when
        jdbc.sql("UPDATE mfa_challenge SET expires_at = :now WHERE id = :id").param("id", id)
                .param("now", clock.instant().atOffset(ZoneOffset.UTC)).update();
        // then
        assertThat(challenges.setPayload(id, account, 0, MfaChallenges.Purpose.LOGIN, "one", "late-options")).isFalse();
    }

    @Test
    void givenThePendingSessionLimit_whenIssuingChallengesForMoreBrowsers_thenOnlyTheNewestChallengesRemain() {
        // given
        UUID account = account();
        UUID first = challenges.issue(account, 0, MfaChallenges.Purpose.LOGIN, "one", "").orElseThrow();
        UUID second = challenges.issue(account, 0, MfaChallenges.Purpose.LOGIN, "two", "").orElseThrow();
        // when
        UUID third = challenges.issue(account, 0, MfaChallenges.Purpose.LOGIN, "three", "").orElseThrow();
        // then
        assertThat(jdbc.sql("SELECT count(*) FROM mfa_challenge WHERE account_id = :id")
                .param("id", account).query(Integer.class).single()).isEqualTo(2);
        assertThat(challenges.attempt(first, account, 0, MfaChallenges.Purpose.LOGIN, "one")).isEmpty();
        assertThat(challenges.attempt(second, account, 0, MfaChallenges.Purpose.LOGIN, "two")).isPresent();
        assertThat(challenges.attempt(third, account, 0, MfaChallenges.Purpose.LOGIN, "three")).isPresent();
    }
}
