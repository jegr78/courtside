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
import org.springframework.jdbc.core.simple.JdbcClient;
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
    private final JdbcClient jdbc;

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
        // Two requests for one account would otherwise both delete and both insert, and the one
        // whose insert lost would already have handed its code to the relay.
        lockIssuing(accountId);
        tokens.deleteForAccount(accountId);
        tokens.save(new PasswordResetToken(accountId, ResetCodes.fingerprint(code),
                ResetCodes.fingerprintOfAddress(address), account.getSecurityEpoch(),
                now, expiresAt));
        return new IssuedResetCode(address, account.getPerson().getFirstName(),
                account.getLocale(), account.getUsername(), code, expiresAt);
    }

    @Transactional
    void redeem(String code, String password) {
        PasswordResetToken token = tokens.findByCodeHash(ResetCodes.fingerprint(code))
                .orElseThrow(ResetCodeInvalidException::new);
        // The row outlives the refusal: it is what lets a member who retries be told their code ran
        // out rather than that it never existed.
        if (token.hasExpiredBy(clock.instant())) {
            throw new ResetCodeExpiredException();
        }
        UserAccount account = accounts.findById(token.getAccountId())
                .filter(UserAccount::isEnabled)
                .filter(token::stillDescribes)
                .orElseThrow(ResetCodeInvalidException::new);
        requireAcceptable(password, account);
        // Keyed on the code and not on its account: a request that replaced this code while the
        // rules ran must not have its replacement deleted by the code it replaced.
        if (tokens.deleteByCodeHash(token.getCodeHash()) != 1) {
            throw new ResetCodeInvalidException();
        }
        if (accounts.replacePasswordAfterReset(account.getId(), token.getSecurityEpoch(),
                passwordEncoder.encode(password)) != 1) {
            throw new ResetCodeInvalidException();
        }
        sessions.endFor(account.getUsername());
        securityEvents.credentialChangedAfterCommit(account.getId(), null,
                SecurityEventLog.CredentialChange.PERMANENT_PASSWORD_REPLACED);
        events.publishEvent(new PasswordResetRedeemed(account.getId()));
    }

    // Nobody proved the current password to get here, so telling a caller they guessed it would
    // hand a stolen code more than the account it unlocks.
    private void requireAcceptable(String password, UserAccount account) {
        try {
            policy.requireUnguessable(password, account);
        } catch (ReusedCredentialException reused) {
            throw new GuessablePasswordException();
        }
    }

    private void lockIssuing(UUID accountId) {
        jdbc.sql("SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))) lock")
                .param("key", "PASSWORD_RESET_TOKEN:" + accountId)
                .query(Long.class)
                .single();
    }

    @Transactional
    void deleteExpired() {
        tokens.deleteExpired(clock.instant());
    }
}
