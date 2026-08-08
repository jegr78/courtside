package org.courtside.facility;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface OpeningHoursRepository extends JpaRepository<OpeningHours, UUID> {

    Optional<OpeningHours> findByDayOfWeek(int dayOfWeek);

    List<OpeningHours> findAllByOrderByDayOfWeekAsc();

    void deleteByDayOfWeek(int dayOfWeek);
}
