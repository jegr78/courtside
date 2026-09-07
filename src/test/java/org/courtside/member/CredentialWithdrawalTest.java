package org.courtside.member;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.CredentialState;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

import java.time.Clock;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Import(IdentityTestFixture.class)
class CredentialWithdrawalTest extends AbstractIntegrationTest {

    private final ListAppender<ILoggingEvent> recorded = new ListAppender<>();

    @Autowired
    private RosterService roster;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private UserAccountRepository accounts;

    @Autowired
    private Clock clock;

    @BeforeEach
    void attachSecurityEventAppender() {
        recorded.start();
        eventLogger().addAppender(recorded);
    }

    @AfterEach
    void detachSecurityEventAppender() {
        eventLogger().detachAppender(recorded);
        recorded.stop();
    }

    @Test
    void givenACredentialSentToAnAddressWithATypo_whenItIsCorrected_thenWhatWasSentStopsWorking() {
        // given
        UUID personId = identity.createPerson("Jane", "Doe", "jane.doa@example.org");
        UUID accountId = identity.createAccountAwaitingCredentials(
                personId, "doe.jane", Set.of(Role.MEMBER));
        identity.issueCredential(accountId, "a-credential", clock.instant().plusSeconds(3600));
        long epochBefore = account(accountId).getSecurityEpoch();

        // when
        roster.changePerson(personId, "Jane", "Doe", "jane.doe@example.org");

        // then — a stranger who accepted the message holds nothing that still authenticates
        UserAccount account = account(accountId);
        assertThat(account.getPasswordHash()).isNull();
        assertThat(account.credentialState(clock.instant()))
                .isEqualTo(CredentialState.AWAITING_CREDENTIAL);
        assertThat(account.getSecurityEpoch()).isGreaterThan(epochBefore);
        assertThat(credentialWithdrawalEvents()).singleElement().satisfies(event ->
                assertThat(event.getKeyValuePairs()).anySatisfy(pair -> {
                    assertThat(pair.key).isEqualTo("account.id");
                    assertThat(pair.value).hasToString(accountId.toString());
                }));
    }

    @Test
    void givenTheSameAddressIsWrittenAgain_whenTheNameChanges_thenNothingIsWithdrawn() {
        // given
        UUID personId = identity.createPerson("Jane", "Doa", "jane.doe@example.org");
        UUID accountId = identity.createAccountAwaitingCredentials(
                personId, "doe.jane", Set.of(Role.MEMBER));
        identity.issueCredential(accountId, "a-credential", clock.instant().plusSeconds(3600));

        // when
        roster.changePerson(personId, "Jane", "Doe", "jane.doe@example.org");

        // then — correcting a surname must not lock a member out of a message already delivered
        assertThat(account(accountId).credentialState(clock.instant()))
                .isEqualTo(CredentialState.CREDENTIAL_ISSUED);
        assertThat(credentialWithdrawalEvents()).isEmpty();
    }

    @Test
    void givenAMemberWhoChoseTheirOwnPassword_whenTheAddressIsCorrected_thenTheyKeepIt() {
        // given
        UUID personId = identity.createPerson("Jane", "Doe", "jane.doa@example.org");
        UUID accountId = identity.createEnabledAccount(
                personId, "doe.jane", "their-own-hash", Set.of(Role.MEMBER));

        // when
        roster.changePerson(personId, "Jane", "Doe", "jane.doe@example.org");

        // then — the withdrawal binds the issued credential only, as the expiry already does
        UserAccount account = account(accountId);
        assertThat(account.getPasswordHash()).isEqualTo("their-own-hash");
        assertThat(account.credentialState(clock.instant()))
                .isEqualTo(CredentialState.PASSWORD_CHOSEN);
        assertThat(credentialWithdrawalEvents()).isEmpty();
    }

    @Test
    void givenASynchronisationCorrectsTheAddress_whenItRuns_thenItWithdrawsTheSameWay() {
        // given
        UUID personId = identity.createPerson("Jane", "Doe", "jane.doa@example.org");
        UUID accountId = identity.createAccountAwaitingCredentials(
                personId, "doe.jane", Set.of(Role.MEMBER));
        identity.issueCredential(accountId, "a-credential", clock.instant().plusSeconds(3600));

        // when — the import is as able to correct an address as a board member is
        roster.correctPerson(personId, null, null, "jane.doe@example.org");

        // then
        assertThat(account(accountId).getPasswordHash()).isNull();
    }

    @Test
    void givenACredentialThatCameFromTheEnvironment_whenTheAddressIsCorrected_thenItSurvives() {
        // given — the bootstrap administrator: a password nobody mailed, and no deadline on it
        UUID personId = identity.createPerson("Ada", "Admin", "admin@localhost.invalid");
        UUID accountId = identity.createAccountWithEnvironmentCredential(
                personId, "admin", "from-the-environment", Set.of(Role.ADMIN));

        // when
        roster.changePerson(personId, "Ada", "Admin", "board@example.org");

        // then — withdrawing it would lock a club out of its own instance
        assertThat(account(accountId).getPasswordHash()).isEqualTo("from-the-environment");
        assertThat(credentialWithdrawalEvents()).isEmpty();
    }

    @Test
    void givenAnAccountHolder_whenASynchronisationClearsTheirAddress_thenItIsRefusedTheSameWay() {
        // given
        UUID personId = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        identity.createAccountAwaitingCredentials(personId, "doe.jane", Set.of(Role.MEMBER));

        // when / then — an account with no address can be sent nothing, whichever path clears it
        assertThatThrownBy(() -> roster.correctPerson(personId, null, null, ""))
                .isInstanceOf(AccountAddressRequiredException.class);
        assertThat(identity.personName(personId)).isEqualTo("Jane Doe");
    }

    private UserAccount account(UUID accountId) {
        return accounts.findById(accountId).orElseThrow();
    }

    private java.util.List<ILoggingEvent> credentialWithdrawalEvents() {
        return recorded.list.stream()
                .filter(event -> event.getKeyValuePairs().stream().anyMatch(pair ->
                        pair.key.equals("event.action")
                                && pair.value.equals("TEMPORARY_CREDENTIAL_WITHDRAWN")))
                .toList();
    }

    private static Logger eventLogger() {
        return (Logger) LoggerFactory.getLogger("org.courtside.security.events");
    }
}
