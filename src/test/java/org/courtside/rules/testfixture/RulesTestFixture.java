package org.courtside.rules.testfixture;

import lombok.RequiredArgsConstructor;
import org.courtside.rules.RuleType;
import org.courtside.rules.internal.RuleAdminService;

import java.util.Map;
import java.util.UUID;

@RequiredArgsConstructor
public class RulesTestFixture {

    private final RuleAdminService rules;

    public UUID activeRuleSet(String name) {
        return rules.createRuleSet(name).getId();
    }

    public UUID ruleSetBarringCourtBookings(String name) {
        UUID ruleSetId = activeRuleSet(name);
        rules.setRule(ruleSetId, RuleType.NO_COURT_BOOKING, Map.of());
        return ruleSetId;
    }

    public void deactivate(UUID ruleSetId) {
        rules.setRuleSetActive(ruleSetId, false);
    }

    public UUID inactiveRuleSet(String name) {
        UUID ruleSetId = activeRuleSet(name);
        rules.setRuleSetActive(ruleSetId, false);
        return ruleSetId;
    }
}
