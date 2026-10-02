package org.courtside.facility.internal;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface OpeningHoursVersionRepository extends JpaRepository<OpeningHoursVersion, UUID> {

    @Override
    @Query("SELECT v FROM OpeningHoursVersion v")
    List<OpeningHoursVersion> findAll();

    Optional<OpeningHoursVersion> findByEffectiveFrom(LocalDate effectiveFrom);

    Optional<OpeningHoursVersion> findByEffectiveFromIsNull();
}
