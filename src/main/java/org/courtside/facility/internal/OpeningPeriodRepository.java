package org.courtside.facility.internal;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface OpeningPeriodRepository extends JpaRepository<OpeningPeriodRow, UUID> {
}
