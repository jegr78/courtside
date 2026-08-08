package org.courtside.rules.internal;

import org.courtside.rules.RuleContext;
import org.courtside.rules.RuleViolation;

import java.util.List;

public interface BookingRule {

    List<RuleViolation> check(RuleContext context);

    // Overridable rules restrict who may book. Non-overridable ones describe the grid itself —
    // the booking UI cannot express a slot that breaks them, so no caller may create one either.
    default boolean isOverridable() {
        return true;
    }
}
