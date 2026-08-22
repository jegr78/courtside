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

    @Column(name = "password_hash", nullable = false)
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

    // Between creation and delivery the hash is of a value nobody kept, so no input matches it and
    // the encoder never warns about a broken one; the absent expiry is what says nothing is out yet.
    public static UserAccount awaitingCredentials(Person person, String username,
                                                  String placeholderHash, Set<Role> roles) {
        UserAccount account = new UserAccount(person, username, placeholderHash, roles);
        account.requirePasswordChange();
        return account;
    }

    public void credentialsIssued(String passwordHash, Instant expiresAt) {
        this.passwordHash = passwordHash;
        this.credentialsExpireAt = expiresAt;
        requirePasswordChange();
        revokeSessions();
    }

    public UserAccount(Person person, String username, String passwordHash, Set<Role> roles) {
        this.id = UUID.randomUUID();
        this.person = person;
        this.username = username;
        this.passwordHash = passwordHash;
        this.roles = Set.copyOf(roles);
        this.locale = "de";
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

    public Set<Role> getRoles() {
        return Set.copyOf(roles);
    }
}
