package org.courtside.member;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface MemberRepository extends JpaRepository<Member, UUID> {

    List<Member> findByPersonIdOrderByStartedOnAscIdAsc(UUID personId);

    List<Member> findByPersonIdIn(List<UUID> personIds);

    Optional<Member> findByIdAndPersonId(UUID id, UUID personId);

    @Query("""
            SELECT m FROM Member m
            WHERE m.personId = :personId
              AND m.startedOn <= :day AND (m.endedOn IS NULL OR m.endedOn > :day)
            """)
    Optional<Member> findValidOn(@Param("personId") UUID personId, @Param("day") LocalDate day);

    @Query("""
            SELECT m.personId FROM Member m
            WHERE m.membershipTypeId = :membershipTypeId
              AND m.startedOn <= :day AND (m.endedOn IS NULL OR m.endedOn > :day)
            """)
    List<UUID> findHolderIdsOn(@Param("membershipTypeId") UUID membershipTypeId, @Param("day") LocalDate day);

    @Query("""
            SELECT new org.courtside.member.MemberParticipant(p.id, concat(p.firstName, ' ', p.lastName))
            FROM Member m, org.courtside.identity.Person p
            WHERE p.id = m.personId
              AND m.startedOn <= :day AND (m.endedOn IS NULL OR m.endedOn > :day)
              AND lower(concat(p.firstName, ' ', p.lastName)) LIKE concat('%', :query, '%') ESCAPE '!'
              AND NOT EXISTS (SELECT 1 FROM org.courtside.identity.UserAccount a
                              WHERE a.id = :searcherAccountId AND a.person.id = p.id)
            ORDER BY lower(p.lastName), lower(p.firstName), p.id
            """)
    List<MemberParticipant> findParticipants(@Param("query") String query,
                                             @Param("searcherAccountId") UUID searcherAccountId,
                                             @Param("day") LocalDate day,
                                             Pageable pageable);
}
