package org.courtside.dataexchange.internal;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface ImportSourceRepository extends JpaRepository<ImportSource, UUID> {

    List<ImportSource> findAllByOrderBySourceKeyAsc();

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<ImportSource> findWithLockById(UUID id);
}
