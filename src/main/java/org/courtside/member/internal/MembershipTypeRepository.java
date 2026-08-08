package org.courtside.member.internal;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface MembershipTypeRepository extends JpaRepository<MembershipType, UUID> {

    List<MembershipType> findAllByOrderByNameAsc();
}
