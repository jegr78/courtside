package org.courtside.config;

import java.util.Optional;
import java.util.UUID;

// Which rule set measures a person who holds no current membership type. Empty means no
// membership-scoped rule binds them, which is what every installation permitted before a club chose.
public interface RuleSetForPeopleWithoutAMembershipType {

    Optional<UUID> ruleSetId();
}
