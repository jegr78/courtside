package org.courtside.identity;

import org.courtside.AbstractIntegrationTest;
import org.courtside.shared.CredentialIssuer;
import org.courtside.shared.IssuedCredential;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class CredentialIssueTest extends AbstractIntegrationTest {

    @Autowired
    private CredentialIssuer credentials;

    @Autowired
    private UserAccountRepository accounts;

    @Autowired
    private PersonRepository people;

    @Autowired
    private PasswordEncoder passwordEncoder;

    @Test
    void givenAnAccountNobodyHasCredentialsFor_whenOneIsIssued_thenItSignsInAndIsStoredOnlyAsAHash() {
        // given
        UUID accountId = accountAwaitingCredentials();

        // when
        IssuedCredential issued = credentials.issueFor(accountId, expiry());

        // then
        UserAccount account = accounts.findById(accountId).orElseThrow();
        assertThat(passwordEncoder.matches(issued.credential(), account.getPasswordHash())).isTrue();
        assertThat(account.getPasswordHash()).doesNotContain(issued.credential());
        assertThat(issued.expiresAt()).isAfter(Instant.now());
    }

    @Test
    void givenAnAccountAwaitingItsFirstCredential_thenItHoldsNoPasswordAtAll() {
        // given / when
        UUID accountId = accountAwaitingCredentials();

        // then — it has none, and the absent expiry is what says nothing has been issued yet
        UserAccount account = accounts.findById(accountId).orElseThrow();
        assertThat(account.getPasswordHash()).isNull();
        assertThat(account.getCredentialsExpireAt()).isNull();
        assertThat(account.credentialState(Instant.now()))
                .isEqualTo(CredentialState.AWAITING_CREDENTIAL);
    }

    @Test
    void givenTwoAccounts_whenCredentialsAreIssued_thenTheyDifferFromEachOther() {
        // given / when
        String first = credentials.issueFor(accountAwaitingCredentials(), expiry()).credential();
        String second = credentials.issueFor(accountAwaitingCredentials(), expiry()).credential();

        // then
        assertThat(first).isNotEqualTo(second);
    }

    @Test
    void givenAnUnknownAccount_whenIssuingACredential_thenItSaysSoRatherThanFailingLater() {
        // when / then
        assertThatThrownBy(() -> credentials.issueFor(UUID.randomUUID(), expiry()))
                .isInstanceOf(IllegalStateException.class);
    }

    private static Instant expiry() {
        return Instant.now().plus(java.time.Duration.ofDays(7));
    }

    private UUID accountAwaitingCredentials() {
        Person person = people.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        return accounts.save(UserAccount.awaitingCredentials(person,
                "doe.jane." + UUID.randomUUID().toString().substring(0, 8),
                java.util.Set.of(Role.MEMBER), "de")).getId();
    }
}
