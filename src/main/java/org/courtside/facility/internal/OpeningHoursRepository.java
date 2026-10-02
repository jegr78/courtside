package org.courtside.facility.internal;

import org.courtside.facility.OpeningHours;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface OpeningHoursRepository extends JpaRepository<OpeningHours, UUID> {

    @Override
    @Query("SELECT h FROM OpeningHours h")
    List<OpeningHours> findAll();

    Optional<OpeningHours> findByVersionIdAndDayOfWeek(UUID versionId, int dayOfWeek);

    List<OpeningHours> findByVersionId(UUID versionId);

    void deleteByVersionIdAndDayOfWeek(UUID versionId, int dayOfWeek);
}
