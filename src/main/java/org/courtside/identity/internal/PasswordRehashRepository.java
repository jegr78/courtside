package org.courtside.identity.internal;

import org.courtside.identity.UserAccount;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

import java.util.UUID;

interface PasswordRehashRepository extends Repository<UserAccount, UUID> {

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("""
            UPDATE VERSIONED UserAccount account
            SET account.passwordHash = :newHash
            WHERE account.id = :id AND account.passwordHash = :currentHash
            """)
    int rehashPassword(@Param("id") UUID id,
                       @Param("currentHash") String currentHash,
                       @Param("newHash") String newHash);
}
