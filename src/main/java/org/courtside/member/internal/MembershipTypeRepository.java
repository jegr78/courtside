package org.courtside.member.internal;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

public interface MembershipTypeRepository extends JpaRepository<MembershipType, UUID> {

    List<MembershipType> findAllByOrderByNameAsc();

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("""
            UPDATE MembershipType type
            SET type.name = :name
            WHERE type.id = :id AND type.name <> :name AND type.name IN :shipped
            """)
    void nameShippedType(@Param("id") UUID id, @Param("name") String name,
                         @Param("shipped") Collection<String> shipped);
}
