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

    // A move neither creates court time nor adds a booking, so the quantity rules leave it alone.
    // A rule that answers whether somebody may book at all has to say so for itself.
    default boolean appliesToAMove() {
        return !isOverridable();
    }

    @FunctionalInterface
    interface Prepared {

        List<RuleViolation> check(RuleContext context);
    }
}
