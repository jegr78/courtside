package org.courtside.rules.internal;

import org.courtside.rules.RuleContext;
import org.courtside.rules.RuleViolation;

import java.util.List;

public interface BookingRule {

    List<RuleViolation> check(RuleContext context);

    default Prepared prepare() {
        return this::check;
    }

    // Overridable rules restrict who may book; non-overridable ones describe the grid itself.
    default boolean isOverridable() {
        return true;
    }

    @FunctionalInterface
    interface Prepared {

        List<RuleViolation> check(RuleContext context);
    }
}
