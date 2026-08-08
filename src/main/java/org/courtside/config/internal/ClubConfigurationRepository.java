package org.courtside.config.internal;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

interface ClubConfigurationRepository extends JpaRepository<ClubConfiguration, UUID> {
}
