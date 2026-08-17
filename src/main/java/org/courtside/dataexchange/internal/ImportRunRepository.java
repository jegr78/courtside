package org.courtside.dataexchange.internal;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface ImportRunRepository extends JpaRepository<ImportRun, UUID> {

    List<ImportRun> findBySourceIdOrderByExecutedAtDesc(UUID sourceId);

    boolean existsBySourceId(UUID sourceId);
}
