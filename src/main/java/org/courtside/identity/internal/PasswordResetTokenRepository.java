package org.courtside.identity.internal;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

interface PasswordResetTokenRepository extends JpaRepository<PasswordResetToken, UUID> {

    Optional<PasswordResetToken> findByCodeHash(String codeHash);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("DELETE FROM PasswordResetToken token WHERE token.accountId = :accountId")
    int deleteForAccount(@Param("accountId") UUID accountId);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("DELETE FROM PasswordResetToken token WHERE token.codeHash = :codeHash")
    int deleteByCodeHash(@Param("codeHash") String codeHash);

    @Modifying
    @Query("DELETE FROM PasswordResetToken token WHERE token.expiresAt <= :cutoff")
    int deleteExpired(@Param("cutoff") Instant cutoff);
}
