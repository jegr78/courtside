package org.courtside.facility.internal;

import org.courtside.facility.OpeningHours;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface OpeningHoursRepository extends JpaRepository<OpeningHours, UUID> {

    Optional<OpeningHours> findByVersionIdAndDayOfWeek(UUID versionId, int dayOfWeek);

    List<OpeningHours> findByVersionId(UUID versionId);

    void deleteByVersionIdAndDayOfWeek(UUID versionId, int dayOfWeek);
}
