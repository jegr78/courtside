package org.courtside.identity.internal;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class InitialPasswordSecurityTest extends AbstractIntegrationTest {
    @Autowired private InitialPasswordService initial;
    @Autowired private AccountCredentialIssuer issuer;
    @Autowired private UserAccountRepository accounts;
    @Autowired private PersonRepository people;
    @Autowired private PasswordEncoder passwords;
    @Autowired private PlatformTransactionManager transactions;
    private UUID account;

    @BeforeEach
    void createAccount() {
        UserAccount holder = temporary("Jane", "Doe", "jane.doe@example.org", "doe.jane");
        account = holder.getId();
        authenticate(holder.getId(), holder.getUsername(), holder.getSecurityEpoch());
    }

    @AfterEach
    void clearPrincipal() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void givenACachedOldSession_whenANewerCredentialWasIssued_thenTheOldRequestCannotReplaceIt() throws Exception {
        // given
        var transaction = new TransactionTemplate(transactions);
        var newHash = new java.util.concurrent.atomic.AtomicReference<String>();
        try (var executor = Executors.newSingleThreadExecutor()) {
            transaction.executeWithoutResult(status -> {
                accounts.findById(account).orElseThrow();
                try {
                    newHash.set(executor.submit(() -> {
                        issuer.issueFor(account, Instant.now().plusSeconds(300), issued -> { });
                        return accounts.findById(account).orElseThrow().getPasswordHash();
                    }).get(30, TimeUnit.SECONDS));
                } catch (Exception failure) {
                    throw new AssertionError("The newer credential did not commit", failure);
                }
                // when / then
                assertThatThrownBy(() -> initial.change("another-unusual-password"))
                        .isInstanceOf(ReauthenticationFailedException.class);
                status.setRollbackOnly();
            });
        }
        assertThat(accounts.findById(account).orElseThrow().getPasswordHash()).isEqualTo(newHash.get());
        assertThat(accounts.findById(account).orElseThrow().isPasswordChangeRequired()).isTrue();
    }

    @Test
    void givenAnotherAccountsUsernameInThePrincipal_whenInitialPasswordChanges_thenItsIdentityBindingRefusesIt() {
        // given
        UserAccount other = temporary("John", "Roe", "john.roe@example.org", "roe.john");
        authenticate(account, other.getUsername(), other.getSecurityEpoch());
        String previous = other.getPasswordHash();
        // when / then
        assertThatThrownBy(() -> initial.change("another-unusual-password"))
                .isInstanceOf(ReauthenticationFailedException.class);
        assertThat(accounts.findById(other.getId()).orElseThrow().getPasswordHash()).isEqualTo(previous);
    }

    @Test
    void givenADisabledAccount_whenInitialPasswordChanges_thenItIsRefused() {
        // given
        UserAccount holder = accounts.findById(account).orElseThrow();
        holder.disable();
        accounts.saveAndFlush(holder);
        authenticate(account, holder.getUsername(), holder.getSecurityEpoch());
        // when / then
        assertThatThrownBy(() -> initial.change("another-unusual-password"))
                .isInstanceOf(ReauthenticationFailedException.class);
    }

    @Test
    void givenAPermanentPasswordAlreadyChosen_whenInitialPasswordChanges_thenItIsRefusedWithATypedFailure() {
        // given
        UserAccount holder = accounts.findById(account).orElseThrow();
        holder.replacePermanentPassword(passwords.encode("already-chosen-password"));
        accounts.saveAndFlush(holder);
        authenticate(account, holder.getUsername(), holder.getSecurityEpoch());
        // when / then
        assertThatThrownBy(() -> initial.change("another-unusual-password"))
                .isInstanceOf(ReauthenticationFailedException.class);
    }

    private UserAccount temporary(String first, String last, String email, String username) {
        Person person = people.save(new Person(first, last, email));
        UserAccount holder = new UserAccount(person, username, passwords.encode("temporary-credential"), Set.of(Role.MEMBER), "en");
        holder.enable();
        holder.requirePasswordChange();
        return accounts.save(holder);
    }

    private void authenticate(UUID id, String username, long epoch) {
        var principal = new CourtsideUserDetails(id, username, "unused", true, true, List.of("ROLE_MEMBER"), epoch);
        var context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(UsernamePasswordAuthenticationToken.authenticated(principal, null, principal.getAuthorities()));
        SecurityContextHolder.setContext(context);
    }
}
