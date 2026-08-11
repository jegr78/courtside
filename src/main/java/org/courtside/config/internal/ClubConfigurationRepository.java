package org.courtside.config.internal;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import jakarta.persistence.LockModeType;

import java.util.Optional;
import java.util.UUID;

interface ClubConfigurationRepository extends JpaRepository<ClubConfiguration, UUID> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT configuration FROM ClubConfiguration configuration WHERE configuration.id = :id")
    Optional<ClubConfiguration> lockById(@Param("id") UUID id);
}
