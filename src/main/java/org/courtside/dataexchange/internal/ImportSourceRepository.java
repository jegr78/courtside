package org.courtside.dataexchange.internal;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface ImportSourceRepository extends JpaRepository<ImportSource, UUID> {

    List<ImportSource> findAllByOrderBySourceKeyAsc();
}
