package org.courtside.facility.internal;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.UUID;

public interface CourtClosureRepository extends JpaRepository<CourtClosureRow, UUID> {

    @Override
    @Query("SELECT c FROM CourtClosureRow c")
    List<CourtClosureRow> findAll();
}
