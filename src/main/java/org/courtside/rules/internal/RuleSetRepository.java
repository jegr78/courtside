package org.courtside.rules.internal;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

public interface RuleSetRepository extends JpaRepository<RuleSet, UUID> {

    List<RuleSet> findAllByOrderByNameAsc();

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("""
            UPDATE RuleSet ruleSet
            SET ruleSet.name = :name
            WHERE ruleSet.id = :id AND ruleSet.name <> :name AND ruleSet.name IN :shipped
            """)
    void nameShippedRuleSet(@Param("id") UUID id, @Param("name") String name,
                            @Param("shipped") Collection<String> shipped);
}
