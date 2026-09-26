package org.courtside.identity.internal;

import org.courtside.identity.UserAccount;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.UUID;

interface SignInRecordRepository extends Repository<UserAccount, UUID> {

    // Skips a row another change holds, so a sign-in never waits on it; the next sign-in records the time.
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = """
            UPDATE user_account SET last_login_at = :signedInAt
            WHERE id = (SELECT id FROM user_account WHERE id = :id FOR NO KEY UPDATE SKIP LOCKED)
            """, nativeQuery = true)
    int recordSignIn(@Param("id") UUID id, @Param("signedInAt") Instant signedInAt);
}
