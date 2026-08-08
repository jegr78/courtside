package org.courtside.rules.internal;

import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class RuleAdminService {

    private static final String UNIQUE_NAME_CONSTRAINT = "rule_set_unique_name";

    private final RuleSetRepository ruleSets;
    private final RuleDefinitionRepository definitions;

    public List<RuleSet> allRuleSets() {
        return ruleSets.findAllByOrderByNameAsc();
    }

    @Transactional
    public RuleSet createRuleSet(String name) {
        return saveOrRejectTakenName(new RuleSet(name));
    }

    @Transactional
    public RuleSet changeRuleSet(UUID ruleSetId, String name) {
        RuleSet ruleSet = requireRuleSet(ruleSetId);
        ruleSet.rename(name);
        return saveOrRejectTakenName(ruleSet);
    }

    @Transactional
    public RuleSet setRuleSetActive(UUID ruleSetId, boolean active) {
        RuleSet ruleSet = requireRuleSet(ruleSetId);
        if (active) {
            ruleSet.activate();
        } else {
            ruleSet.deactivate();
        }
        return ruleSet;
    }

    public RuleSet requireRuleSet(UUID ruleSetId) {
        return ruleSets.findById(ruleSetId)
                .orElseThrow(() -> new RuleSetNotFoundException("No rule set with id " + ruleSetId));
    }

    public List<RuleDefinition> rulesOf(UUID ruleSetId) {
        requireRuleSet(ruleSetId);
        return definitions.findByRuleSetIdOrderByRuleTypeAsc(ruleSetId);
    }

    @Transactional
    public RuleDefinition setRule(UUID ruleSetId, RuleType type, Map<String, Integer> params) {
        requireRuleSet(ruleSetId);
        Map<String, Integer> validated = RuleParameters.validated(type, params);
        return definitions.findByRuleSetIdAndRuleType(ruleSetId, type)
                .map(definition -> {
                    definition.changeTo(validated);
                    return definition;
                })
                .orElseGet(() -> definitions.save(
                        new RuleDefinition(ruleSetId, type, validated)));
    }

    @Transactional
    public void removeRule(UUID ruleSetId, RuleType type) {
        requireRuleSet(ruleSetId);
        definitions.findByRuleSetIdAndRuleType(ruleSetId, type)
                .ifPresent(definitions::delete);
    }

    private RuleSet saveOrRejectTakenName(RuleSet ruleSet) {
        try {
            return ruleSets.saveAndFlush(ruleSet);
        } catch (DataIntegrityViolationException e) {
            if (isNameTaken(e)) {
                throw new RuleSetNameTakenException(
                        "Rule set name '" + ruleSet.getName() + "' is already taken", e);
            }
            throw e;
        }
    }

    private boolean isNameTaken(DataIntegrityViolationException e) {
        String message = e.getMostSpecificCause().getMessage();
        return message != null && message.contains(UNIQUE_NAME_CONSTRAINT);
    }
}
