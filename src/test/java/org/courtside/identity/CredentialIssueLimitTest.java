package org.courtside.identity;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.time.Clock;
import java.time.Duration;
import java.time.ZoneOffset;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class CredentialIssueLimitTest extends AbstractIntegrationTest {

    private static final int CONFIGURED_MAXIMUM = 5;

    @Autowired
    private AccountCredentials credentials;

    @Autowired
    private PersonRepository persons;

    @Autowired
    private UserAccountRepository accounts;

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private Clock clock;

    @Test
    void givenABoardIssuingTwiceInARow_whenTheSecondIsAsked_thenNothingSlowsThemDown() {
        // given
        UUID accountId = anAccount("doe.jane", "jane.doe@example.org");

        // when / then
        assertThatCode(() -> {
            credentials.issueTo(accountId);
            credentials.issueTo(accountId);
        }).doesNotThrowAnyException();
    }

    @Test
    void givenSomebodyFillingAMailbox_whenTheWindowIsFull_thenTheNextOneIsRefused() {
        // given
        UUID accountId = anAccount("doe.jane", "jane.doe@example.org");
        for (int issued = 0; issued < CONFIGURED_MAXIMUM; issued++) {
            credentials.issueTo(accountId);
        }

        // when / then
        assertThatThrownBy(() -> credentials.issueTo(accountId))
                .extracting("code").isEqualTo("identity.credentials.rateLimited");
    }

    @Test
    void givenOneAccountHasFilledItsWindow_whenAnotherIsIssued_thenItIsUnaffected() {
        // given
        UUID filled = anAccount("doe.jane", "jane.doe@example.org");
        UUID other = anAccount("roe.john", "john.roe@example.org");
        for (int issued = 0; issued < CONFIGURED_MAXIMUM; issued++) {
            credentials.issueTo(filled);
        }

        // when / then — the account is the unit, so one member cannot block another's issuing
        assertThatCode(() -> credentials.issueTo(other)).doesNotThrowAnyException();
    }

    @Test
    void givenAWindowThatFilledUpAndRanOut_whenIssuingAgain_thenTheBoardIsNotLockedOutForever() {
        // given
        UUID accountId = anAccount("doe.jane", "jane.doe@example.org");
        for (int issued = 0; issued < CONFIGURED_MAXIMUM; issued++) {
            credentials.issueTo(accountId);
        }
        windowStarted(accountId, Duration.ofHours(2));

        // when / then — the count bounds a burst, and a board must not have to wait out a day
        assertThatCode(() -> credentials.issueTo(accountId)).doesNotThrowAnyException();
    }

    private void windowStarted(UUID accountId, Duration ago) {
        jdbc.sql("""
                        UPDATE credential_issue_limit SET window_started_at = :startedAt
                        WHERE account_id = :accountId
                        """)
                .param("startedAt", clock.instant().minus(ago).atOffset(ZoneOffset.UTC))
                .param("accountId", accountId)
                .update();
    }

    private UUID anAccount(String username, String email) {
        Person person = persons.save(new Person("Jane", "Doe", email));
        UserAccount account = UserAccount.awaitingCredentials(
                person, username, Set.of(Role.MEMBER), "de");
        account.enable();
        return accounts.save(account).getId();
    }
}
