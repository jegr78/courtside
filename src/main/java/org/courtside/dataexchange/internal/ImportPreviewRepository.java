package org.courtside.dataexchange.internal;

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

public interface ImportPreviewRepository extends JpaRepository<ImportPreview, UUID> {

    List<ImportPreview> findBySourceIdAndSupersededAtIsNull(UUID sourceId);

    @Query("SELECT preview.sourceId FROM ImportPreview preview WHERE preview.id = :id")
    Optional<UUID> findSourceIdById(@Param("id") UUID id);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<ImportPreview> findWithLockById(UUID id);

    // Two columns per row: a full-row flush would restore what a concurrent upload had just
    // dropped, and loading the previews would read a whole membership list in order to erase it.
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("""
            UPDATE ImportPreview preview
            SET preview.changeSet = null, preview.fingerprints = null
            WHERE preview.expiresAt <= :cutoff AND preview.changeSet IS NOT NULL
            """)
    int forgetExpired(@Param("cutoff") Instant cutoff);
}
