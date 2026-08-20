package org.courtside.rules.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.shared.ConfigurationSubjectNames;
import org.springframework.stereotype.Component;

import java.util.Collection;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

@Component
@RequiredArgsConstructor
class RuleSetNames implements ConfigurationSubjectNames {

    private final RuleSetRepository ruleSets;

    @Override
    public Map<UUID, String> namesFor(Collection<UUID> subjectIds) {
        Map<UUID, String> names = new HashMap<>();
        ruleSets.findAllById(subjectIds)
                .forEach(ruleSet -> names.put(ruleSet.getId(), ruleSet.getName()));
        return names;
    }
}
