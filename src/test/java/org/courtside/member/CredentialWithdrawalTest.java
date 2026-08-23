package org.courtside.member;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.CredentialState;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

import java.time.Clock;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@Import(IdentityTestFixture.class)
class CredentialWithdrawalTest extends AbstractIntegrationTest {

    @Autowired
    private RosterService roster;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private UserAccountRepository accounts;

    @Autowired
    private Clock clock;

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
    }

    private UserAccount account(UUID accountId) {
        return accounts.findById(accountId).orElseThrow();
    }
}
