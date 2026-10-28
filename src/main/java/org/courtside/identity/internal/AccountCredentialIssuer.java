package org.courtside.identity.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.identity.AccountSessions;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.shared.CredentialIssuer;
import org.courtside.shared.CredentialSupersededException;
import org.courtside.shared.IssuedCredential;
import org.courtside.shared.SecurityEventLog;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.UUID;
import java.util.function.Consumer;

@Component
@RequiredArgsConstructor
class AccountCredentialIssuer implements CredentialIssuer {

    private static final int CREDENTIAL_BYTES = 24;

    private final UserAccountRepository accounts;
    private final AccountSessions sessions;
    private final PasswordEncoder passwordEncoder;
    private final SecurityEventLog securityEvents;
    private final RecoveryAccountGuard recoveryGuard;
    private final SecureRandom random = new SecureRandom();

    @Override
    @Transactional
    public void issueFor(UUID accountId, Instant expiresAt, Consumer<IssuedCredential> handOver) {
        UserAccount account = accounts.findById(accountId).orElseThrow(() ->
                new IllegalStateException("No account to issue a credential for"));
        recoveryGuard.requireAvailable(accountId);
        String address = account.getPerson().getEmail();
        if (address == null || address.isBlank()) {
            throw new IllegalStateException("Account " + accountId
                    + " has no address to send its credential to");
        }
        String credential = generated();
        String username = account.getUsername();
        String previousHash = account.getPasswordHash();
        handOver.accept(new IssuedCredential(address, account.getPerson().getFirstName(),
                account.getLocale(), username, credential, expiresAt));
        String encoded = passwordEncoder.encode(credential);
        recoveryGuard.lockAndRequireAvailable(accountId);
        if (accounts.issueCredential(accountId, encoded, expiresAt, previousHash) != 1) {
            throw new CredentialSupersededException();
        }
        sessions.endFor(username);
        securityEvents.credentialChangedAfterCommit(accountId, null,
                SecurityEventLog.CredentialChange.TEMPORARY_CREDENTIAL_ISSUED);
    }

    private String generated() {
        byte[] bytes = new byte[CREDENTIAL_BYTES];
        random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }
}
