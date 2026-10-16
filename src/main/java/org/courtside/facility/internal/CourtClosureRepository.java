package org.courtside.facility.internal;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface CourtClosureRepository extends JpaRepository<CourtClosureRow, UUID> {
}
