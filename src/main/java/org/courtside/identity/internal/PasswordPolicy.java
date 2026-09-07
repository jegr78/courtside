package org.courtside.identity.internal;

import lombok.extern.slf4j.Slf4j;
import org.courtside.config.ClubIdentity;
import org.courtside.identity.Person;
import org.courtside.identity.UserAccount;
import org.springframework.core.io.ClassPathResource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.text.Normalizer;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.Stream;

@Slf4j
@Component
class PasswordPolicy {

    private static final String LIST = "security/common-passwords.txt";
    private static final Pattern SEPARATOR = Pattern.compile("[^\\p{L}\\p{N}]+");
    // Shorter than this a name is a syllable, and refusing every passphrase that happens to
    // contain it would push members back to the short passwords this exists to prevent.
    private static final int SHORTEST_CONTEXT_TERM = 4;

    private final Set<String> common;
    private final ClubIdentity club;
    private final PasswordEncoder passwordEncoder;
    private final BreachedPasswordLookup breachedPasswords;
    private final Set<String> operatorTerms;

    @Autowired
    PasswordPolicy(ClubIdentity club, PasswordEncoder passwordEncoder,
                   BreachedPasswordLookup breachedPasswords, PasswordPolicyProperties properties) {
        this(club, passwordEncoder, breachedPasswords, loadedOperatorTerms(properties.termsFile()));
    }

    PasswordPolicy(ClubIdentity club, PasswordEncoder passwordEncoder) {
        this(club, passwordEncoder, password -> false, Set.of());
    }

    PasswordPolicy(ClubIdentity club, PasswordEncoder passwordEncoder,
                   BreachedPasswordLookup breachedPasswords, Set<String> operatorTerms) {
        this.club = club;
        this.passwordEncoder = passwordEncoder;
        this.breachedPasswords = breachedPasswords;
        this.operatorTerms = operatorTerms.stream()
                .map(PasswordPolicy::normalised)
                .collect(Collectors.toUnmodifiableSet());
        this.common = loaded();
        log.info("The permanent-password policy holds {} common passwords and {} operator-provided terms",
                common.size(), this.operatorTerms.size());
    }

    void requireUnguessable(String password, UserAccount account) {
        if (password == null) {
            throw new IllegalStateException("A password reached the policy without being validated");
        }
        String normalised = normalised(password);
        if (common.contains(normalised)) {
            throw new GuessablePasswordException();
        }
        if (contextTerms(account).anyMatch(normalised::contains)) {
            throw new GuessablePasswordException();
        }
        if (operatorTerms.stream().anyMatch(normalised::contains)) {
            throw new GuessablePasswordException();
        }
        // Last, because it is the only check that costs a key derivation.
        if (account.getPasswordHash() != null
                && passwordEncoder.matches(password, account.getPasswordHash())) {
            throw new ReusedCredentialException();
        }
        if (breachedPasswords.isBreached(password)) {
            throw new GuessablePasswordException();
        }
    }

    private Stream<String> contextTerms(UserAccount account) {
        Person person = account.getPerson();
        return Stream.of(account.getUsername(), localPart(person.getEmail()),
                        person.getFirstName(), person.getLastName(), club.clubName())
                .filter(source -> source != null && !source.isBlank())
                .flatMap(source -> Stream.concat(Stream.of(source), SEPARATOR.splitAsStream(source)))
                .map(PasswordPolicy::normalised)
                .filter(term -> term.length() >= SHORTEST_CONTEXT_TERM);
    }

    private static String localPart(String emailAddress) {
        if (emailAddress == null) {
            return null;
        }
        int at = emailAddress.indexOf('@');
        return at < 0 ? emailAddress : emailAddress.substring(0, at);
    }

    private static Set<String> loaded() {
        try (BufferedReader lines = new BufferedReader(new InputStreamReader(
                new ClassPathResource(LIST).getInputStream(), StandardCharsets.UTF_8))) {
            Set<String> passwords = lines.lines()
                    .map(PasswordPolicy::normalised)
                    .filter(line -> !line.isEmpty())
                    .collect(Collectors.toUnmodifiableSet());
            if (passwords.isEmpty()) {
                throw new IllegalStateException(LIST + " holds no password to refuse");
            }
            return passwords;
        } catch (IOException unreadable) {
            throw new IllegalStateException(LIST + " could not be read", unreadable);
        }
    }

    private static Set<String> loadedOperatorTerms(String file) {
        if (file == null || file.isBlank()) {
            return Set.of();
        }
        Path path = Path.of(file);
        try {
            if (!path.isAbsolute() || !Files.isRegularFile(path) || !Files.isReadable(path)) {
                throw new IllegalStateException("COURTSIDE_PASSWORD_TERMS_FILE must name a readable absolute file");
            }
            Set<String> terms = Files.readAllLines(path, StandardCharsets.UTF_8).stream()
                    .map(String::strip)
                    .filter(term -> !term.isEmpty())
                    .map(PasswordPolicy::normalised)
                    .collect(Collectors.toUnmodifiableSet());
            if (terms.isEmpty()) {
                throw new IllegalStateException("COURTSIDE_PASSWORD_TERMS_FILE holds no term to refuse");
            }
            return terms;
        } catch (IOException unreadable) {
            throw new IllegalStateException("COURTSIDE_PASSWORD_TERMS_FILE could not be read", unreadable);
        }
    }

    private static String normalised(String value) {
        return Normalizer.normalize(value, Normalizer.Form.NFKC).toLowerCase(Locale.ROOT);
    }
}
