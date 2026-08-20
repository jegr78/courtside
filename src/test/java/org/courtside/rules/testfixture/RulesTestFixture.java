package org.courtside.rules.testfixture;

import lombok.RequiredArgsConstructor;
import org.courtside.rules.internal.RuleAdminService;

import java.util.UUID;

@RequiredArgsConstructor
public class RulesTestFixture {

    private final RuleAdminService rules;

    public UUID activeRuleSet(String name) {
        return rules.createRuleSet(name).getId();
    }
}
