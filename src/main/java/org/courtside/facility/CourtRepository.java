package org.courtside.facility;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface CourtRepository extends JpaRepository<Court, UUID> {

    List<Court> findByActiveTrueOrderByNumberAsc();

    List<Court> findAllByOrderByNumberAsc();
}
