package org.courtside.facility.internal;

import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;

public interface OpeningHoursVersionRepository extends JpaRepository<OpeningHoursVersion, UUID> {

    Optional<OpeningHoursVersion> findByEffectiveFrom(LocalDate effectiveFrom);

    Optional<OpeningHoursVersion> findByEffectiveFromIsNull();
}
