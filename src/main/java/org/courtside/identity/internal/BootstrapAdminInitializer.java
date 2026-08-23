package org.courtside.identity.internal;

import org.courtside.config.ClubIdentity;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.core.annotation.Order;

import java.util.Set;

@Component
@RequiredArgsConstructor
@Order(0)
class BootstrapAdminInitializer implements ApplicationRunner {

    private static final String LOCAL_ADMIN_EMAIL = "admin@localhost.invalid";

    private final BootstrapLock lock;
    private final PersonRepository persons;
    private final UserAccountRepository accounts;
    private final PasswordEncoder passwordEncoder;
    private final BootstrapAdminProperties properties;
    private final ClubIdentity club;

    @Override
    @Transactional
    public void run(ApplicationArguments arguments) {
        lock.acquire();

        if (accounts.count() > 0) {
            return;
        }

        BootstrapValues values = requiredValues();
        Name name = Name.parse(values.displayName());
        Person person = persons.save(new Person(name.firstName(), name.lastName(), LOCAL_ADMIN_EMAIL));
        UserAccount account = new UserAccount(person, values.username(),
                passwordEncoder.encode(values.password()), Set.of(Role.ADMIN), club.defaultLocale());
        account.enable();
        account.requirePasswordChange();
        accounts.save(account);
    }

    private BootstrapValues requiredValues() {
        String username = required("COURTSIDE_BOOTSTRAP_ADMIN_USERNAME", properties.username());
        String password = requiredSecret(
                "COURTSIDE_BOOTSTRAP_ADMIN_PASSWORD", properties.password());
        String displayName = required("COURTSIDE_BOOTSTRAP_ADMIN_DISPLAY_NAME", properties.displayName());
        if (password.length() < 12) {
            throw new IllegalStateException(
                    "COURTSIDE_BOOTSTRAP_ADMIN_PASSWORD must contain at least 12 characters");
        }
        if (accounts.existsByUsername(username)) {
            throw new IllegalStateException("The bootstrap admin username already exists");
        }
        return new BootstrapValues(username, password, displayName);
    }

    private static String required(String environmentName, String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalStateException(environmentName
                    + " is required while the instance has no local account");
        }
        return value.trim();
    }

    private static String requiredSecret(String environmentName, String value) {
        if (value == null || value.isEmpty()) {
            throw new IllegalStateException(environmentName
                    + " is required while the instance has no local account");
        }
        return value;
    }

    private record BootstrapValues(String username, String password, String displayName) {
    }

    private record Name(String firstName, String lastName) {
        static Name parse(String displayName) {
            int separator = displayName.lastIndexOf(' ');
            if (separator < 1 || separator == displayName.length() - 1) {
                throw new IllegalStateException(
                        "COURTSIDE_BOOTSTRAP_ADMIN_DISPLAY_NAME must contain a first and last name");
            }
            return new Name(displayName.substring(0, separator).trim(),
                    displayName.substring(separator + 1).trim());
        }
    }
}
