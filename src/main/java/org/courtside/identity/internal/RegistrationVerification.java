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
@Table(name = "registration_verification")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
class RegistrationVerification {

    @Id
    @Column(name = "account_id", nullable = false, updatable = false)
    private UUID accountId;

    @Column(name = "code_hash")
    private String codeHash;

    @Column(name = "security_epoch", nullable = false, updatable = false)
    private long securityEpoch;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "expires_at", nullable = false, updatable = false)
    private Instant expiresAt;

    RegistrationVerification(UUID accountId, long securityEpoch, Instant createdAt, Instant expiresAt) {
        this.accountId = accountId;
        this.securityEpoch = securityEpoch;
        this.createdAt = createdAt;
        this.expiresAt = expiresAt;
    }

    void issue(String codeHash) {
        this.codeHash = codeHash;
    }

    boolean stillDescribes(UserAccount account) {
        return securityEpoch == account.getSecurityEpoch() && !account.isEnabled();
    }

    boolean hasExpiredBy(Instant now) {
        return !expiresAt.isAfter(now);
    }
}
