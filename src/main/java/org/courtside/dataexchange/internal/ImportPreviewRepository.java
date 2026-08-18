package org.courtside.dataexchange.internal;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface ImportPreviewRepository extends JpaRepository<ImportPreview, UUID> {

    List<ImportPreview> findBySourceIdAndSupersededAtIsNull(UUID sourceId);

    @Query("SELECT preview.sourceId FROM ImportPreview preview WHERE preview.id = :id")
    Optional<UUID> findSourceIdById(@Param("id") UUID id);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<ImportPreview> findWithLockById(UUID id);
}
