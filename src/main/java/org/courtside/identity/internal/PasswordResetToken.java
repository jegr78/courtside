package org.courtside.identity.internal;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import org.courtside.identity.UserAccount;

import java.time.Instant;
import java.util.UUID;

@Entity
@Getter
@Table(name = "password_reset_token")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
class PasswordResetToken {

    @Id
    @Column(name = "account_id", nullable = false, updatable = false)
    private UUID accountId;

    @Column(name = "code_hash", nullable = false, updatable = false)
    private String codeHash;

    @Column(name = "address_hash", nullable = false, updatable = false)
    private String addressHash;

    @Column(name = "security_epoch", nullable = false, updatable = false)
    private long securityEpoch;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "expires_at", nullable = false, updatable = false)
    private Instant expiresAt;

    PasswordResetToken(UUID accountId, String codeHash, String addressHash, long securityEpoch,
                       Instant createdAt, Instant expiresAt) {
        this.accountId = accountId;
        this.codeHash = codeHash;
        this.addressHash = addressHash;
        this.securityEpoch = securityEpoch;
        this.createdAt = createdAt;
        this.expiresAt = expiresAt;
    }

    boolean hasExpiredBy(Instant now) {
        return !expiresAt.isAfter(now);
    }

    // Anything that changed the way into this account since the code was mailed withdraws it: a
    // board-issued credential, a password the member chose, a deactivation, a corrected address.
    boolean stillDescribes(UserAccount account) {
        return securityEpoch == account.getSecurityEpoch()
                && addressHash.equals(ResetCodes.fingerprintOfAddress(addressOf(account)));
    }

    private static String addressOf(UserAccount account) {
        String address = account.getPerson().getEmail();
        return address == null ? "" : address;
    }
}
