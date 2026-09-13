package org.courtside.identity.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.config.PasswordResetTokenValidity;
import org.courtside.identity.AccountSessions;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.shared.IssuedResetCode;
import org.courtside.shared.PasswordResetCodeIssuer;
import org.courtside.shared.PasswordResetRedeemed;
import org.courtside.shared.SecurityEventLog;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.UUID;

@Service
@RequiredArgsConstructor
class PasswordResetTokenService implements PasswordResetCodeIssuer {

    private final PasswordResetTokenRepository tokens;
    private final UserAccountRepository accounts;
    private final PasswordResetTokenValidity validity;
    private final PasswordPolicy policy;
    private final PasswordEncoder passwordEncoder;
    private final AccountSessions sessions;
    private final SecurityEventLog securityEvents;
    private final ApplicationEventPublisher events;
    private final Clock clock;

    @Override
    @Transactional
    public IssuedResetCode issueFor(UUID accountId) {
        UserAccount account = accounts.findById(accountId).orElseThrow(() ->
                new IllegalStateException("No account to mail a reset code for: " + accountId));
        String address = account.getPerson().getEmail();
        if (!account.isEnabled() || address == null || address.isBlank()) {
            throw new IllegalStateException(
                    "Account " + accountId + " cannot be reached with a reset code");
        }
        String code = ResetCodes.generate();
        Instant now = clock.instant();
        Instant expiresAt = now.plus(validity.resetCodeLifetime());
        tokens.deleteForAccount(accountId);
        tokens.save(new PasswordResetToken(accountId, ResetCodes.fingerprint(code),
                ResetCodes.fingerprintOfAddress(address), account.getSecurityEpoch(),
                now, expiresAt));
        return new IssuedResetCode(address, account.getPerson().getFirstName(),
                account.getLocale(), account.getUsername(), code, expiresAt);
    }

    // The code is spent by a password the rules accept and by nothing else, so a member who has to
    // correct theirs still holds the one they were sent.
    @Transactional
    void redeem(String code, String password) {
        PasswordResetToken token = tokens.findByCodeHash(ResetCodes.fingerprint(code))
                .orElseThrow(ResetCodeInvalidException::new);
        if (token.hasExpiredBy(clock.instant())) {
            tokens.deleteForAccount(token.getAccountId());
            throw new ResetCodeExpiredException();
        }
        UserAccount account = accounts.findById(token.getAccountId())
                .filter(UserAccount::isEnabled)
                .filter(token::stillDescribes)
                .orElseThrow(ResetCodeInvalidException::new);
        policy.requireUnguessable(password, account);
        accounts.replacePasswordAfterReset(account.getId(), passwordEncoder.encode(password));
        tokens.deleteForAccount(account.getId());
        sessions.endFor(account.getUsername());
        securityEvents.credentialChangedAfterCommit(account.getId(), null,
                SecurityEventLog.CredentialChange.PERMANENT_PASSWORD_REPLACED);
        events.publishEvent(new PasswordResetRedeemed(account.getId()));
    }

    @Transactional
    void withdrawFor(UUID accountId) {
        tokens.deleteForAccount(accountId);
    }

    @Transactional
    void deleteExpired() {
        tokens.deleteExpired(clock.instant());
    }
}
