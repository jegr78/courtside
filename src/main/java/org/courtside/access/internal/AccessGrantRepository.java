package org.courtside.access.internal;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.UUID;

public interface AccessGrantRepository extends JpaRepository<AccessGrant, UUID> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT g FROM AccessGrant g WHERE g.id = :id")
    Optional<AccessGrant> findLockedById(@Param("id") UUID id);

    Optional<AccessGrant> findByBookingId(UUID bookingId);
}
