package org.courtside.config;

import java.util.UUID;

// Whether a rule set may still be pointed at. Retiring one takes it out of the choices; what
// already names it keeps naming it, so this answers a new assignment and never an existing one.
public interface RuleSetAvailability {

    boolean isRetired(UUID ruleSetId);
}
