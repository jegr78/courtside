package org.courtside.rules.internal;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface RuleDefinitionRepository extends JpaRepository<RuleDefinition, UUID> {

    List<RuleDefinition> findByRuleSetIdOrderByRuleTypeAsc(UUID ruleSetId);

    Optional<RuleDefinition> findByRuleSetIdAndRuleType(UUID ruleSetId, RuleType ruleType);
}
