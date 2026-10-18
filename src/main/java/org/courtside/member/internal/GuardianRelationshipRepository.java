package org.courtside.member.internal;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface GuardianRelationshipRepository extends JpaRepository<GuardianRelationship, UUID> {

    @Query("""
            SELECT r FROM GuardianRelationship r
            WHERE r.guardianPersonId = :personId OR r.dependantPersonId = :personId
            ORDER BY r.startedOn, r.id
            """)
    List<GuardianRelationship> findInvolving(@Param("personId") UUID personId);

    @Query("""
            SELECT new org.courtside.member.internal.GuardianRelationshipRepository$Parties(
                r.guardianPersonId, r.dependantPersonId)
            FROM GuardianRelationship r
            WHERE r.id = :id AND (r.guardianPersonId = :personId OR r.dependantPersonId = :personId)
            """)
    Optional<Parties> findPartiesInvolving(@Param("id") UUID id, @Param("personId") UUID personId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT r FROM GuardianRelationship r WHERE r.id = :id")
    Optional<GuardianRelationship> findWithLockById(@Param("id") UUID id);

    record Parties(UUID guardianPersonId, UUID dependantPersonId) {
    }

    List<GuardianRelationship> findByGuardianPersonIdAndDependantPersonId(UUID guardianPersonId,
                                                                          UUID dependantPersonId);

    List<GuardianRelationship> findByGuardianPersonId(UUID guardianPersonId);
}
