package org.courtside.identity;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

class CredentialStateTest {

    private static final Instant NOW = Instant.parse("2026-08-23T10:00:00Z");
    private static final Instant EARLIER = NOW.minusSeconds(3600);
    private static final Instant LATER = NOW.plusSeconds(3600);

    @Test
    void givenAnAccountThatWasNeverIssuedOne_whenReadingItsState_thenItIsAwaitingACredential() {
        // given
        UserAccount account = awaiting();

        // when / then
        assertThat(account.credentialState(NOW)).isEqualTo(CredentialState.AWAITING_CREDENTIAL);
    }

    @Test
    void givenACredentialThatIsStillWithinItsWindow_whenReadingTheState_thenItIsIssued() {
        // given
        UserAccount account = awaiting();
        account.credentialsIssued("a-hash", LATER);

        // when / then
        assertThat(account.credentialState(NOW)).isEqualTo(CredentialState.CREDENTIAL_ISSUED);
    }

    @Test
    void givenACredentialWhoseWindowHasPassed_whenReadingTheState_thenItIsExpired() {
        // given
        UserAccount account = awaiting();
        account.credentialsIssued("a-hash", EARLIER);

        // when / then
        assertThat(account.credentialState(NOW)).isEqualTo(CredentialState.CREDENTIAL_EXPIRED);
    }

    @Test
    void givenAMemberWhoChoseTheirOwnPassword_whenReadingTheState_thenTheyHaveOne() {
        // given — the change query clears the deadline and the requirement together
        UserAccount account = new UserAccount(person(), "doe.jane", "their-own-hash",
                Set.of(Role.MEMBER), "de");

        // when / then
        assertThat(account.credentialState(NOW)).isEqualTo(CredentialState.PASSWORD_CHOSEN);
    }

    @Test
    void givenTheBootstrapAdministrator_whenReadingTheState_thenItsCredentialCountsAsIssued() {
        // given — a password from the environment: it must still be replaced and never expires
        UserAccount account = new UserAccount(person(), "admin", "from-the-environment",
                Set.of(Role.ADMIN), "de");
        account.requirePasswordChange();

        // when / then — a required change without a deadline is not a fifth state
        assertThat(account.credentialState(NOW)).isEqualTo(CredentialState.CREDENTIAL_ISSUED);
    }

    @Test
    void givenTheExactMomentTheWindowCloses_whenReadingTheState_thenItIsAlreadyExpired() {
        // given
        UserAccount account = awaiting();
        account.credentialsIssued("a-hash", NOW);

        // when / then — the same boundary isCredentialExpired already draws
        assertThat(account.credentialState(NOW)).isEqualTo(CredentialState.CREDENTIAL_EXPIRED);
        assertThat(account.isCredentialExpired(NOW)).isTrue();
    }

    private static UserAccount awaiting() {
        return UserAccount.awaitingCredentials(person(), "doe.jane", Set.of(Role.MEMBER), "de");
    }

    private static Person person() {
        return new Person("Jane", "Doe", "jane.doe@example.org");
    }
}
