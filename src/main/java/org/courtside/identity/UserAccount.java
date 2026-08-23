package org.courtside.identity;

import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.Set;
import java.util.UUID;

@Entity
@Table(name = "user_account")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class UserAccount {

    @Id
    private UUID id;

    @ManyToOne(fetch = FetchType.EAGER, optional = false)
    @JoinColumn(name = "person_id", nullable = false)
    private Person person;

    @Column(nullable = false, unique = true)
    private String username;

    @Column(name = "password_hash")
    private String passwordHash;

    @Column(nullable = false)
    private String locale;

    @Column(nullable = false)
    private boolean enabled;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "password_change_required", nullable = false)
    private boolean passwordChangeRequired;

    @Column(name = "credentials_expire_at")
    private Instant credentialsExpireAt;

    @Column(name = "security_epoch", nullable = false)
    private long securityEpoch;

    @Version
    @Column(nullable = false)
    private long version;

    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "user_account_role",
            joinColumns = @JoinColumn(name = "user_account_id"))
    @Column(name = "role", nullable = false)
    @Enumerated(EnumType.STRING)
    private Set<Role> roles;

    // An account before its first issue holds no password, because it has none: the sign-in path
    // answers such a row exactly as it answers a wrong one, and nothing here can be matched.
    public static UserAccount awaitingCredentials(Person person, String username, Set<Role> roles,
                                                  String locale) {
        UserAccount account = new UserAccount(person, username, null, roles, locale);
        account.requirePasswordChange();
        return account;
    }

    public CredentialState credentialState(Instant now) {
        if (passwordHash == null) {
            return CredentialState.AWAITING_CREDENTIAL;
        }
        if (!passwordChangeRequired) {
            return CredentialState.PASSWORD_CHOSEN;
        }
        return isCredentialExpired(now)
                ? CredentialState.CREDENTIAL_EXPIRED
                : CredentialState.CREDENTIAL_ISSUED;
    }

    public void credentialsIssued(String passwordHash, Instant expiresAt) {
        this.passwordHash = passwordHash;
        this.credentialsExpireAt = expiresAt;
        requirePasswordChange();
        revokeSessions();
    }

    public UserAccount(Person person, String username, String passwordHash, Set<Role> roles,
                       String locale) {
        this.id = UUID.randomUUID();
        this.person = person;
        this.username = username;
        this.passwordHash = passwordHash;
        this.roles = Set.copyOf(roles);
        this.locale = locale;
        this.enabled = false;
        this.passwordChangeRequired = false;
        this.createdAt = Instant.now();
    }

    public void enable() {
        this.enabled = true;
    }

    public void disable() {
        this.enabled = false;
        revokeSessions();
    }

    public void changeRoles(Set<Role> roles) {
        Set<Role> replacement = Set.copyOf(roles);
        if (!replacement.containsAll(this.roles)) {
            revokeSessions();
        }
        this.roles = replacement;
    }

    public void changeUsername(String username) {
        if (this.username.equals(username)) {
            return;
        }
        this.username = username;
        revokeSessions();
    }

    // Not a security attribute: it decides what a message says, not what the account may do, so a
    // session signed in under the old language stays valid.
    public void changeLocale(String locale) {
        this.locale = locale;
    }

    // An address correction cannot reach a message already sent, so what was sent stops working. A
    // credential with no deadline came from the environment and is not this instance's to withdraw.
    public void withdrawUnusedCredential() {
        if (credentialsExpireAt == null || !passwordChangeRequired) {
            return;
        }
        this.passwordHash = null;
        this.credentialsExpireAt = null;
        revokeSessions();
    }

    public void resetPassword(String passwordHash) {
        this.passwordHash = passwordHash;
        requirePasswordChange();
        revokeSessions();
    }

    void revokeSessions() {
        this.securityEpoch++;
    }

    public void requirePasswordChange() {
        this.passwordChangeRequired = true;
    }

    // Only while the issued credential is still the one in use: a member who has set their own
    // password keeps it, and the column the change query leaves behind must not lock them out.
    public boolean isCredentialExpired(Instant now) {
        return passwordChangeRequired && credentialsExpireAt != null
                && !now.isBefore(credentialsExpireAt);
    }

    public Set<Role> getRoles() {
        return Set.copyOf(roles);
    }
}
