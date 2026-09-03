package org.courtside.rules.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.rules.RuleType;
import org.courtside.rules.RulesEvent;
import org.courtside.shared.SqlConstraintViolation;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class RuleAdminService {

    private static final String UNIQUE_NAME_CONSTRAINT = "rule_set_unique_name";

    private final RuleSetRepository ruleSets;
    private final RuleDefinitionRepository definitions;
    private final ApplicationEventPublisher events;

    public List<RuleSet> allRuleSets() {
        return ruleSets.findAllByOrderByNameAsc();
    }

    @Transactional
    public RuleSet createRuleSet(String name) {
        RuleSet ruleSet = saveOrRejectTakenName(new RuleSet(name));
        events.publishEvent(new RulesEvent.RuleSetAdded(ruleSet.getId()));
        return ruleSet;
    }

    @Transactional
    public RuleSet changeRuleSet(UUID ruleSetId, String name) {
        RuleSet ruleSet = requireRuleSet(ruleSetId);
        boolean nameChanged = !Objects.equals(ruleSet.getName(), name);
        ruleSet.rename(name);
        RuleSet saved = saveOrRejectTakenName(ruleSet);
        if (nameChanged) {
            events.publishEvent(new RulesEvent.RuleSetChanged(saved.getId(), List.of("name")));
        }
        return saved;
    }

    @Transactional
    public RuleSet setRuleSetActive(UUID ruleSetId, boolean active) {
        RuleSet ruleSet = requireRuleSet(ruleSetId);
        if (ruleSet.isActive() == active) {
            return ruleSet;
        }
        if (active) {
            ruleSet.activate();
        } else {
            ruleSet.deactivate();
        }
        events.publishEvent(new RulesEvent.RuleSetAvailabilityChanged(ruleSet.getId(), active));
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
        Optional<RuleDefinition> existing = definitions.findByRuleSetIdAndRuleType(ruleSetId, type);
        RuleDefinition definition;
        boolean changed;
        if (existing.isPresent()) {
            definition = existing.get();
            changed = !definition.getParams().equals(validated);
            definition.changeTo(validated);
        } else {
            definition = definitions.save(new RuleDefinition(ruleSetId, type, validated));
            changed = true;
        }
        if (changed) {
            events.publishEvent(new RulesEvent.RuleDefinitionSet(ruleSetId, type, validated));
        }
        return definition;
    }

    @Transactional
    public void removeRule(UUID ruleSetId, RuleType type) {
        requireRuleSet(ruleSetId);
        definitions.findByRuleSetIdAndRuleType(ruleSetId, type)
                .ifPresent(definition -> {
                    events.publishEvent(new RulesEvent.RuleDefinitionRemoved(ruleSetId, type));
                    definitions.delete(definition);
                });
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
        return SqlConstraintViolation.matches(
                e, SqlConstraintViolation.UNIQUE_VIOLATION, UNIQUE_NAME_CONSTRAINT);
    }
}
