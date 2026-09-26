package org.courtside.identity.internal;

import org.courtside.identity.UserAccount;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.UUID;

interface SignInRecordRepository extends Repository<UserAccount, UUID> {

    // Outside the entity's version, so a member signing in never fails an administrator's edit.
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = "UPDATE user_account SET last_login_at = :signedInAt WHERE id = :id", nativeQuery = true)
    int recordSignIn(@Param("id") UUID id, @Param("signedInAt") Instant signedInAt);
}
