package org.courtside.rules;

import java.util.Map;

// Message bundles address these by name, not by position — Map has no ordering.
public record RuleViolation(String code, Map<String, Object> params) {

    public RuleViolation {
        params = Map.copyOf(params);
    }
}
