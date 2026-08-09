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
            UPDATE UserAccount account
            SET account.passwordHash = :passwordHash, account.passwordChangeRequired = false
            WHERE account.id = :id AND account.passwordChangeRequired = true
            """)
    int changeInitialPassword(@Param("id") UUID id, @Param("passwordHash") String passwordHash);

    List<UserAccount> findByPersonIdIn(List<UUID> personIds);
}
