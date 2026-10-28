package org.courtside.identity.internal;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.time.Clock;
import java.time.Duration;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class SecondFactorAttemptLimitTest extends AbstractIntegrationTest {

    @Autowired private LoginAttemptProtection attempts;
    @Autowired private LoginAttemptCleanup cleanup;
    @Autowired private PersonRepository people;
    @Autowired private UserAccountRepository accounts;
    @Autowired private JdbcClient jdbc;
    @Autowired private Clock clock;
    private UUID account;
    private int sequence;

    @BeforeEach
    void setUp() {
        UserAccount holder = new UserAccount(people.save(new Person("Jane", "Doe", "jane.doe@example.org")),
                "doe.jane." + UUID.randomUUID(), "unused", Set.of(Role.MEMBER), "en");
        holder.enable();
        account = accounts.save(holder).getId();
    }

    @Test
    void givenFiveFailedProofs_whenTheBlockHasPassed_thenTheNextFiveBlockTwiceAsLong() {
        // given
        failTimes(5);
        assertThat(attempt()).map(LoginBlock::retryAfter).contains(Duration.ofMinutes(1));
        passBlock();
        // when
        failTimes(5);
        // then
        assertThat(attempt()).as("a second block lasts twice as long as the first")
                .map(LoginBlock::retryAfter).contains(Duration.ofMinutes(2));
    }

    @Test
    void givenProofsFailingForDays_whenTheBlocksEscalate_thenNoBlockExceedsADay() {
        // given
        for (int round = 0; round < 14; round++) {
            failTimes(5);
            passBlock();
        }
        // when
        failTimes(5);
        // then
        assertThat(attempt()).as("escalation stops at the maximum block")
                .map(LoginBlock::retryAfter).contains(Duration.ofHours(24));
    }

    @Test
    void givenFailuresHoursApart_whenTheAddressWindowHasLongPassed_thenTheyStillCountTowardsTheBlock() {
        // given
        failTimes(4);
        jdbc.sql("UPDATE login_attempt_limit SET window_started_at = window_started_at - INTERVAL '6 hours'").update();
        cleanup.deleteExpiredAttempts();
        // when
        Optional<LoginBlock> fifth = attempt();
        // then
        assertThat(fifth).isEmpty();
        assertThat(attempt()).as("failures far apart are consecutive failures, not a new window")
                .map(LoginBlock::retryAfter).contains(Duration.ofMinutes(1));
    }

    @Test
    void givenFailedProofs_whenAProofSucceeds_thenTheCountStartsAgain() {
        // given
        failTimes(4);
        // when
        attempts.clearFactorAttempt(account);
        // then
        failTimes(4);
        assertThat(attempt()).as("four failures after a success do not block").isEmpty();
    }

    @Test
    void givenRepeatedBlocks_whenTheyBegin_thenTheHolderIsNotifiedOncePerRun() {
        // given
        failTimes(5);
        passBlock();
        // when
        failTimes(5);
        // then
        assertThat(jdbc.sql("""
                SELECT count(*) FROM notification WHERE account_id = :id AND kind = 'ACCOUNT_FACTOR_GUESSING_BLOCKED'
                """).param("id", account).query(Long.class).single())
                .as("the holder learns about guessing at the first block, not at every escalation").isEqualTo(1);
    }

    @Test
    void givenAQuietMonth_whenCleanupRuns_thenOnlyThenTheFailuresAreForgotten() {
        // given
        failTimes(4);
        jdbc.sql("UPDATE login_attempt_limit SET window_started_at = window_started_at - INTERVAL '29 days'").update();
        cleanup.deleteExpiredAttempts();
        failTimes(1);
        assertThat(attempt()).as("failures within the retention still block").isPresent();
        jdbc.sql("UPDATE login_attempt_limit SET window_started_at = window_started_at - INTERVAL '31 days', "
                + "blocked_until = NULL").update();
        // when
        cleanup.deleteExpiredAttempts();
        // then
        assertThat(jdbc.sql("SELECT count(*) FROM login_attempt_limit WHERE scope = 'FACTOR'").query(Long.class)
                .single()).as("a month without failures forgets the run").isZero();
    }

    private Optional<LoginBlock> attempt() {
        return attempts.registerFactorAttempt(account, "192.0.2." + (++sequence % 250));
    }

    private void failTimes(int times) {
        for (int failure = 0; failure < times; failure++) assertThat(attempt()).isEmpty();
    }

    private void passBlock() {
        jdbc.sql("UPDATE login_attempt_limit SET blocked_until = :past WHERE blocked_until IS NOT NULL")
                .param("past", clock.instant().minusSeconds(1).atOffset(ZoneOffset.UTC)).update();
    }
}
