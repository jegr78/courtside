package org.courtside.identity.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.config.PasswordResetTokenValidity;
import org.courtside.identity.AccountAddresses;
import org.courtside.identity.AccountMfaChanged;
import org.courtside.identity.AccountSessions;
import org.courtside.identity.ControlledRecoveryCodeIssuer;
import org.courtside.identity.ControlledRecoveryRequested;
import org.courtside.identity.CurrentUser;
import org.courtside.identity.RecentAuthentication;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.shared.IssuedResetCode;
import org.courtside.shared.SecurityEventLog;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Locale;
import java.util.UUID;

@Service
@RequiredArgsConstructor
class ControlledAccountRecovery implements ControlledRecoveryCodeIssuer {
    private final UserAccountRepository accounts;
    private final jakarta.persistence.EntityManager entities;
    private final CurrentUser current;
    private final RecentAuthentication recent;
    private final MfaFactors factors;
    private final MfaTotpRepository totp;
    private final MfaRecoveryCodeRepository codes;
    private final MfaWebAuthnCredentials credentials;
    private final LoginAttemptProtection attempts;
    private final PasswordPolicy policy;
    private final PasswordEncoder passwords;
    private final jakarta.validation.Validator validator;
    private final PasswordResetTokenValidity validity;
    private final AccountSessions sessions;
    private final AccountAddresses addresses;
    private final SecurityEventLog security;
    private final ApplicationEventPublisher events;
    private final JdbcClient jdbc;
    private final Clock clock;

    @Transactional
    UUID initiate(UUID target, boolean identityChecked) {
        if (target == null) throw new MfaProofFailedException();
        UUID actorId = current.accountId().orElseThrow(MfaProofFailedException::new);
        jdbc.sql("SELECT id FROM user_account WHERE id IN (:ids) ORDER BY id FOR UPDATE")
                .param("ids", java.util.List.of(actorId, target)).query(UUID.class).list();
        UserAccount actor = locked(actorId);
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !(authentication.getPrincipal() instanceof CourtsideUserDetails principal)
                || !actor.getId().equals(principal.accountId()) || !actor.getUsername().equals(principal.getUsername())
                || actor.getSecurityEpoch() != principal.securityEpoch()
                || !actor.isEnabled() || actor.isPasswordChangeRequired() || !actor.getRoles().contains(Role.ADMIN)
                || !factors.enabled(actor.getId()) || factors.recoveryPending(actor.getId())) {
            throw new MfaProofFailedException();
        }
        recent.requireRecent();
        return initiateLocked(target, actor.getId(), identityChecked);
    }

    @Transactional
    UUID initiateFromMaintenance(UUID target, boolean identityChecked) {
        return initiateLocked(target, null, identityChecked);
    }

    private UUID initiateLocked(UUID target, UUID actor, boolean identityChecked) {
        if (!identityChecked) throw new MfaProofFailedException();
        UserAccount holder = locked(target);
        String address = holder.getPerson().getEmail();
        if (!holder.isEnabled() || address == null || address.isBlank()) throw new MfaProofFailedException();
        UUID recoveryId = UUID.randomUUID();
        sessions.revoke(holder);
        accounts.saveAndFlush(holder);
        jdbc.sql("""
                INSERT INTO account_mfa (account_id, recovery_pending) VALUES (:id, true)
                ON CONFLICT (account_id) DO UPDATE SET recovery_pending = true
                """).param("id", target).update();
        jdbc.sql("DELETE FROM account_mfa_recovery WHERE account_id = :id").param("id", target).update();
        jdbc.sql("""
                INSERT INTO account_mfa_recovery (account_id, recovery_id, security_epoch, address_hash, created_at)
                VALUES (:id, :recovery, :epoch, :address, :created)
                """).param("id", target).param("recovery", recoveryId).param("epoch", holder.getSecurityEpoch())
                .param("address", ResetCodes.fingerprintOfAddress(address)).param("created", clock.instant().atOffset(ZoneOffset.UTC)).update();
        security.administrativeActionAfterCommit(target, actor,
                actor == null ? SecurityEventLog.AdministrativeAction.MFA_RECOVERY_MAINTENANCE_INITIATED
                        : SecurityEventLog.AdministrativeAction.MFA_RECOVERY_INITIATED);
        events.publishEvent(new ControlledRecoveryRequested(target, recoveryId));
        return recoveryId;
    }

    @Override
    @Transactional
    public IssuedResetCode issueFor(UUID accountId, UUID recoveryId) {
        UserAccount holder = locked(accountId);
        Recovery recovery = recovery(accountId);
        if (recovery == null || !recovery.recoveryId().equals(recoveryId) || !valid(holder, recovery)
                || !factors.recoveryPending(accountId)) throw new ResetCodeInvalidException();
        String code = MfaRecoveryCodes.generate().getFirst();
        Instant expires = clock.instant().plus(validity.resetCodeLifetime());
        jdbc.sql("UPDATE account_mfa_recovery SET code_hash = :hash, expires_at = :expires WHERE account_id = :id")
                .param("hash", verifier(code)).param("expires", expires.atOffset(ZoneOffset.UTC)).param("id", accountId).update();
        return new IssuedResetCode(holder.getPerson().getEmail(), holder.getPerson().getFirstName(),
                holder.getLocale(), holder.getUsername(), code, expires);
    }

    @Transactional
    Redemption redeem(String username, String code, String password, String address) {
        String subject = username == null ? "" : username.strip().toLowerCase(Locale.ROOT);
        if (attempts.registerRecoveryAttempt("mfa-rescue:" + subject, "mfa-rescue:" + address).isPresent()) {
            security.controlRefused(null, SecurityEventLog.ControlRefusal.MFA_RECOVERY_FAILED);
            return Redemption.LIMITED;
        }
        var found = accounts.findWithLockByUsername(username == null ? "" : username);
        if (found.isEmpty()) return refused(null, Redemption.INVALID);
        UserAccount holder = found.orElseThrow();
        entities.refresh(holder, jakarta.persistence.LockModeType.PESSIMISTIC_WRITE);
        entities.refresh(holder.getPerson());
        Recovery recovery = recovery(holder.getId());
        if (recovery == null || recovery.codeHash() == null || !valid(holder, recovery)
                || !factors.recoveryPending(holder.getId()) || code == null || code.length() > 128
                || !recovery.codeHash().equals(verifier(code))) return refused(holder.getId(), Redemption.INVALID);
        if (!recovery.expires().isAfter(clock.instant())) return refused(holder.getId(), Redemption.EXPIRED);
        if (password == null || password.length() < 12 || password.length() > 256) throw new GuessablePasswordException();
        try {
            policy.requireUnguessable(password, holder);
        } catch (ReusedCredentialException reused) {
            throw new GuessablePasswordException();
        }
        holder.replacePermanentPassword(passwords.encode(password));
        totp.remove(holder.getId());
        credentials.deleteAll(holder.getId());
        codes.clear(holder.getId());
        jdbc.sql("DELETE FROM mfa_challenge WHERE account_id = :id").param("id", holder.getId()).update();
        jdbc.sql("DELETE FROM account_mfa_recovery WHERE account_id = :id").param("id", holder.getId()).update();
        jdbc.sql("UPDATE account_mfa SET recovery_pending = false WHERE account_id = :id").param("id", holder.getId()).update();
        sessions.endFor(holder.getUsername());
        security.credentialChangedAfterCommit(holder.getId(), null, SecurityEventLog.CredentialChange.MFA_RECOVERY_REDEEMED);
        events.publishEvent(new AccountMfaChanged(holder.getId()));
        return Redemption.ACCEPTED;
    }

    @Transactional
    void correctEmailFromMaintenance(UUID account, String email, boolean identityChecked) {
        if (!identityChecked || !validator.validate(new RecoveryEmail(email)).isEmpty()) throw new MfaProofFailedException();
        UserAccount holder = locked(account);
        addresses.change(holder.getPerson(), email);
        sessions.revoke(holder);
        jdbc.sql("DELETE FROM account_mfa_recovery WHERE account_id = :id").param("id", account).update();
        security.administrativeActionAfterCommit(account, null, SecurityEventLog.AdministrativeAction.MFA_RECOVERY_EMAIL_CORRECTED);
        events.publishEvent(new AccountMfaChanged(account));
    }

    private UserAccount locked(UUID account) {
        if (account == null) throw new MfaProofFailedException();
        jdbc.sql("SELECT id FROM user_account WHERE id = :id FOR UPDATE")
                .param("id", account).query(UUID.class).optional().orElseThrow(MfaProofFailedException::new);
        UserAccount holder = accounts.findById(account).orElseThrow(MfaProofFailedException::new);
        entities.refresh(holder, jakarta.persistence.LockModeType.PESSIMISTIC_WRITE);
        entities.refresh(holder.getPerson());
        return holder;
    }

    private Recovery recovery(UUID account) {
        return jdbc.sql("SELECT recovery_id, security_epoch, address_hash, code_hash, expires_at FROM account_mfa_recovery WHERE account_id = :id")
                .param("id", account).query((rs, row) -> new Recovery(rs.getObject(1, UUID.class), rs.getLong(2),
                        rs.getString(3), rs.getString(4), rs.getObject(5, OffsetDateTime.class) == null ? null
                        : rs.getObject(5, OffsetDateTime.class).toInstant())).optional().orElse(null);
    }

    private boolean valid(UserAccount holder, Recovery recovery) {
        return holder.isEnabled() && holder.getSecurityEpoch() == recovery.epoch()
                && holder.getPerson().getEmail() != null
                && recovery.addressHash().equals(ResetCodes.fingerprintOfAddress(holder.getPerson().getEmail()));
    }

    private Redemption refused(UUID account, Redemption result) {
        security.controlRefused(account, SecurityEventLog.ControlRefusal.MFA_RECOVERY_FAILED);
        return result;
    }

    private static String verifier(String code) {
        return ResetCodes.fingerprint("MFA_ACCOUNT_RESCUE:" + code);
    }

    private record RecoveryEmail(@jakarta.validation.constraints.NotBlank @jakarta.validation.constraints.Email
                                 @jakarta.validation.constraints.Size(max = 120)
                                 @jakarta.validation.constraints.Pattern(regexp = "[^\\x00-\\x20\\x7f-\\x9f@]+@[^\\x00-\\x20\\x7f-\\x9f@.]+(\\.[^\\x00-\\x20\\x7f-\\x9f@.]+)+") String value) { }

    enum Redemption { ACCEPTED, INVALID, EXPIRED, LIMITED }
    private record Recovery(UUID recoveryId, long epoch, String addressHash, String codeHash, Instant expires) { }
}
