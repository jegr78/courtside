package org.courtside.identity.testfixture;

import lombok.RequiredArgsConstructor;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.springframework.security.crypto.password.PasswordEncoder;

import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;

import java.util.Locale;
import java.util.Set;
import java.util.UUID;

@RequiredArgsConstructor
public class IdentityTestFixture {

    private final PersonRepository persons;
    private final UserAccountRepository accounts;
    private final UserDetailsService userDetails;
    private final PasswordEncoder passwordEncoder;

    public void signInAs(String username) {
        UserDetails details = userDetails.loadUserByUsername(username);
        SecurityContextHolder.getContext().setAuthentication(
                UsernamePasswordAuthenticationToken.authenticated(details, null, details.getAuthorities()));
    }

    public void signOut() {
        SecurityContextHolder.clearContext();
    }

    public UUID createPerson(String firstName, String lastName) {
        String email = (firstName + "." + lastName).toLowerCase(Locale.ROOT) + "@example.org";
        return createPerson(firstName, lastName, email);
    }

    public UUID createPerson(String firstName, String lastName, String email) {
        return persons.save(new Person(firstName, lastName, email)).getId();
    }

    public UUID createAccount(UUID personId, String username, Set<Role> roles) {
        return createAccount(personId, username, "synthetic-test-password-hash", roles);
    }

    public UUID createAccount(UUID personId, String username, String passwordHash, Set<Role> roles) {
        Person person = persons.findById(personId).orElseThrow();
        return accounts.save(new UserAccount(person, username, passwordHash, roles, "de")).getId();
    }

    // What a person holds after a board member adds them and before the message reaches them: no
    // password at all, which is what says nothing has been issued yet.
    public UUID createAccountAwaitingCredentials(UUID personId, String username, Set<Role> roles) {
        Person person = persons.findById(personId).orElseThrow();
        UserAccount account = UserAccount.awaitingCredentials(person, username, roles, "de");
        account.enable();
        return accounts.save(account).getId();
    }

    public UUID createEnabledAccount(UUID personId, String username, Set<Role> roles) {
        return createEnabledAccount(personId, username, "synthetic-test-password-hash", roles);
    }

    public UUID createEnabledAccount(UUID personId, String username, String passwordHash, Set<Role> roles) {
        UserAccount account = accounts.findById(createAccount(personId, username, passwordHash, roles)).orElseThrow();
        account.enable();
        return accounts.save(account).getId();
    }

    public void requirePasswordChange(String username) {
        UserAccount account = accounts.findByUsername(username).orElseThrow();
        account.requirePasswordChange();
        accounts.save(account);
    }

    public void renamePerson(UUID personId, String firstName, String lastName) {
        Person person = persons.findById(personId).orElseThrow();
        person.rename(firstName, lastName);
        persons.saveAndFlush(person);
    }

    public void disableAccount(UUID accountId) {
        UserAccount account = accounts.findById(accountId).orElseThrow();
        account.disable();
        accounts.saveAndFlush(account);
    }

    public UUID createPersonWithLeadingIdDigitIn(
            String firstName, String lastName, String email, String allowedDigits) {
        Person person = new Person(firstName, lastName, email);
        while (allowedDigits.indexOf(person.getId().toString().charAt(0)) < 0) {
            person = new Person(firstName, lastName, email);
        }
        return persons.save(person).getId();
    }

    public boolean personExists(UUID personId) {
        return persons.existsById(personId);
    }

    public String personName(UUID personId) {
        return persons.findById(personId).orElseThrow().getDisplayName();
    }

    public boolean accountExists(UUID accountId) {
        return accounts.existsById(accountId);
    }

    public boolean isAccountEnabled(UUID accountId) {
        return accounts.findById(accountId).orElseThrow().isEnabled();
    }

    public Set<Role> accountRoles(UUID accountId) {
        return accounts.findById(accountId).orElseThrow().getRoles();
    }

    public boolean isPasswordChangeRequired(String username) {
        return accounts.findByUsername(username).orElseThrow().isPasswordChangeRequired();
    }

    public boolean credentialSignsIn(UUID accountId, String credential) {
        return passwordEncoder.matches(credential, storedCredentialHash(accountId));
    }

    public String storedCredentialHash(UUID accountId) {
        return accounts.findById(accountId).orElseThrow().getPasswordHash();
    }

    public UUID personIdForUsername(String username) {
        return accounts.findByUsername(username).orElseThrow().getPerson().getId();
    }
}
