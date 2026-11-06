package org.courtside.identity.internal;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

interface RegistrationVerificationRepository extends JpaRepository<RegistrationVerification, UUID> {

    Optional<RegistrationVerification> findByCodeHash(String codeHash);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("DELETE FROM RegistrationVerification pending WHERE pending.codeHash = :codeHash")
    int deleteByCodeHash(@Param("codeHash") String codeHash);

    @Query("""
            SELECT pending.accountId FROM RegistrationVerification pending, UserAccount account
            WHERE pending.expiresAt <= :cutoff AND account.id = pending.accountId AND account.enabled = false""")
    List<UUID> expiredUnverifiedAccounts(@Param("cutoff") Instant cutoff);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("DELETE FROM RegistrationVerification pending WHERE pending.expiresAt <= :cutoff")
    int deleteExpired(@Param("cutoff") Instant cutoff);
}
