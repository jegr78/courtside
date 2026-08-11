package org.courtside.member;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface MemberRepository extends JpaRepository<Member, UUID> {

    Optional<Member> findByPersonId(UUID personId);

    @Query("""
            SELECT new org.courtside.member.MemberParticipant(p.id, concat(p.firstName, ' ', p.lastName))
            FROM Member m, org.courtside.identity.Person p
            WHERE p.id = m.personId
              AND lower(concat(p.firstName, ' ', p.lastName)) LIKE concat('%', :query, '%') ESCAPE '!'
            ORDER BY lower(p.lastName), lower(p.firstName), p.id
            """)
    List<MemberParticipant> findParticipants(@Param("query") String query, Pageable pageable);
}
