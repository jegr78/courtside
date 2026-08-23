package org.courtside.identity.internal;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.courtside.identity.AccountSessions;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.shared.CredentialIssuer;
import org.courtside.shared.IssuedCredential;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.UUID;

@Slf4j
@Component
@RequiredArgsConstructor
class AccountCredentialIssuer implements CredentialIssuer {

    private static final int CREDENTIAL_BYTES = 24;

    private final UserAccountRepository accounts;
    private final AccountSessions sessions;
    private final PasswordEncoder passwordEncoder;
    private final SecureRandom random = new SecureRandom();

    @Override
    @Transactional
    public IssuedCredential issueFor(UUID accountId, Instant expiresAt) {
        UserAccount account = accounts.findById(accountId).orElseThrow(() ->
                new IllegalStateException("No account to issue a credential for"));
        String address = account.getPerson().getEmail();
        if (address == null || address.isBlank()) {
            throw new IllegalStateException("Account " + accountId
                    + " has no address to send its credential to");
        }
        String credential = generated();
        account.credentialsIssued(passwordEncoder.encode(credential), expiresAt);
        sessions.endFor(account.getUsername());
        log.info("Issued a credential for account {}", accountId);
        return new IssuedCredential(address,
                account.getPerson().getFirstName(), account.getLocale(),
                account.getUsername(), credential, expiresAt);
    }

    // Base64 without padding, so nothing a member retypes is a character they have to guess at.
    private String generated() {
        byte[] bytes = new byte[CREDENTIAL_BYTES];
        random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }
}
