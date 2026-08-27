package org.courtside.identity;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface UserAccountRepository extends JpaRepository<UserAccount, UUID> {

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

    @Query("SELECT account.securityEpoch FROM UserAccount account WHERE account.id = :id")
    Optional<Long> findSecurityEpochById(@Param("id") UUID id);

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
