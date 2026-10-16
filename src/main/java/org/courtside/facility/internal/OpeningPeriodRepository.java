package org.courtside.facility.internal;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.UUID;

public interface OpeningPeriodRepository extends JpaRepository<OpeningPeriodRow, UUID> {

    @Override
    @Query("SELECT DISTINCT p FROM OpeningPeriodRow p LEFT JOIN FETCH p.hours")
    List<OpeningPeriodRow> findAll();
}
