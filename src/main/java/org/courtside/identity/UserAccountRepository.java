package org.courtside.identity;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface UserAccountRepository extends JpaRepository<UserAccount, UUID> {

    // Both belong to whoever goes on to write the row through the entity: two such writers on one
    // account would otherwise race on the version, and the loser of that race is not told.
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<UserAccount> findWithLockByUsername(String username);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    List<UserAccount> findWithLockByPersonIdIn(List<UUID> personIds);

    // One statement rather than a row lock per account: revoking instance-wide must not hold every
    // row while it works, and a counter cannot lose an update.
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("UPDATE VERSIONED UserAccount account SET account.securityEpoch = account.securityEpoch + 1")
    int revokeEverySession();

    // Written after the message is out, so the row is not held while the relay is asked; the epoch
    // is counted up in the database, which is what keeps a concurrent revocation from being lost.
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("""
            UPDATE VERSIONED UserAccount account
            SET account.passwordHash = :passwordHash,
                account.credentialsExpireAt = :expiresAt,
                account.passwordChangeRequired = true,
                account.securityEpoch = account.securityEpoch + 1
            WHERE account.id = :id
            """)
    int issueCredential(@Param("id") UUID id, @Param("passwordHash") String passwordHash,
                        @Param("expiresAt") Instant expiresAt);

    Optional<UserAccount> findByUsername(String username);

    boolean existsByUsername(String username);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("""
            UPDATE VERSIONED UserAccount account
            SET account.passwordHash = :passwordHash,
                account.passwordChangeRequired = false,
                account.credentialsExpireAt = null,
                account.securityEpoch = account.securityEpoch + 1
            WHERE account.id = :id AND account.passwordChangeRequired = true
            """)
    int changeInitialPassword(@Param("id") UUID id, @Param("passwordHash") String passwordHash);

    // Deliberately without the passwordChangeRequired predicate its sibling above carries. The
    // epoch predicate is what makes a withdrawal that lands mid-redemption win the race.
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("""
            UPDATE VERSIONED UserAccount account
            SET account.passwordHash = :passwordHash,
                account.passwordChangeRequired = false,
                account.credentialsExpireAt = null,
                account.securityEpoch = account.securityEpoch + 1
            WHERE account.id = :id
              AND account.enabled = true
              AND account.securityEpoch = :securityEpoch
            """)
    int replacePasswordAfterReset(@Param("id") UUID id,
                                  @Param("securityEpoch") long securityEpoch,
                                  @Param("passwordHash") String passwordHash);

    @Query("SELECT account.securityEpoch FROM UserAccount account WHERE account.id = :id")
    Optional<Long> findSecurityEpochById(@Param("id") UUID id);

    @Query("""
            SELECT account FROM UserAccount account
            WHERE lower(account.person.email) = lower(:email)
            """)
    List<UserAccount> findByPersonEmailIgnoringCase(@Param("email") String email);

    Optional<UserAccount> findByPersonId(UUID personId);

    List<UserAccount> findByPersonIdIn(List<UUID> personIds);

    @Query("""
            SELECT count(account) FROM UserAccount account
            JOIN account.roles role
            WHERE role = :role AND account.enabled = true AND account.id <> :excludedAccountId
            """)
    long countEnabledHoldingRoleExcept(@Param("role") Role role,
                                       @Param("excludedAccountId") UUID excludedAccountId);
}
