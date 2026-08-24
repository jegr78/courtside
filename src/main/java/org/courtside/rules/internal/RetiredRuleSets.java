package org.courtside.rules.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.config.RuleSetAvailability;
import org.springframework.stereotype.Component;

import java.util.UUID;

@Component
@RequiredArgsConstructor
class RetiredRuleSets implements RuleSetAvailability {

    private final RuleSetRepository ruleSets;

    @Override
    public boolean isRetired(UUID ruleSetId) {
        return ruleSets.findById(ruleSetId).filter(ruleSet -> !ruleSet.isActive()).isPresent();
    }
}
