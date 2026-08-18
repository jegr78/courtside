package org.courtside.identity.testfixture;

import lombok.RequiredArgsConstructor;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;

import java.util.Locale;
import java.util.Set;
import java.util.UUID;

@RequiredArgsConstructor
public class IdentityTestFixture {

    private final PersonRepository persons;
    private final UserAccountRepository accounts;

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
        return accounts.save(new UserAccount(person, username, passwordHash, roles)).getId();
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

    public UUID personIdForUsername(String username) {
        return accounts.findByUsername(username).orElseThrow().getPerson().getId();
    }
}
