package org.courtside.access.internal;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface AccessGrantRepository extends JpaRepository<AccessGrant, UUID> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT g FROM AccessGrant g WHERE g.id = :id")
    Optional<AccessGrant> findLockedById(@Param("id") UUID id);

    Optional<AccessGrant> findByBookingId(UUID bookingId);

    @Query(value = """
            SELECT * FROM access_grant
            WHERE wanted OR remote <> 'NONE' OR refused OR attempts > 0
            ORDER BY (refused OR attempts >= 5) DESC, want_from NULLS LAST, id
            LIMIT 100
            """, nativeQuery = true)
    List<AccessGrant> findShown();

    @Query(value = """
            SELECT count(*) FROM access_grant WHERE wanted OR remote <> 'NONE' OR refused OR attempts > 0
            """, nativeQuery = true)
    long countNotDone();
}
