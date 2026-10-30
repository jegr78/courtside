package org.courtside.facility.internal;

import org.courtside.facility.AccessPoint;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface AccessPointRepository extends JpaRepository<AccessPoint, UUID> {

    List<AccessPoint> findAllByOrderByNameAsc();

    @EntityGraph(attributePaths = "courtIds")
    List<AccessPoint> findByActiveTrueAndStaticCodeIsNotNullOrderByNameAsc();

    @EntityGraph(attributePaths = "courtIds")
    List<AccessPoint> findByActiveTrueAndStaticCodeIsNullOrderByNameAsc();

    List<AccessPoint> findByActiveTrueAndOpenToMembersTrueAndStaticCodeIsNotNullOrderByNameAsc();
}
