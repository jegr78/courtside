package org.courtside.dataexchange.internal;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface ExternalReferenceRepository extends JpaRepository<ExternalReference, UUID> {

    Optional<ExternalReference> findBySourceIdAndExternalId(UUID sourceId, String externalId);

    List<ExternalReference> findBySourceId(UUID sourceId);

    boolean existsBySourceId(UUID sourceId);

    @Query("""
            SELECT reference.id FROM ExternalReference reference
            WHERE reference.sourceId = :sourceId
              AND (:after IS NULL
                OR reference.externalId
                       > (SELECT other.externalId FROM ExternalReference other WHERE other.id = :after))
            ORDER BY reference.externalId
            """)
    List<UUID> findIdsBySourceIdAfter(@Param("sourceId") UUID sourceId, @Param("after") UUID after,
                                      Pageable pageable);
}
