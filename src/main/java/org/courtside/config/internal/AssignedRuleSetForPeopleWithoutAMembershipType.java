package org.courtside.config.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.config.RuleSetForPeopleWithoutAMembershipType;
import org.springframework.stereotype.Component;

import java.util.Optional;
import java.util.UUID;

@Component
@RequiredArgsConstructor
class AssignedRuleSetForPeopleWithoutAMembershipType
        implements RuleSetForPeopleWithoutAMembershipType {

    private final ConfigService config;

    @Override
    public Optional<UUID> ruleSetId() {
        return Optional.ofNullable(config.current().noMembershipTypeRuleSetId());
    }
}
