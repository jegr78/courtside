package org.courtside.booking;

import org.courtside.rules.RuleViolation;
import lombok.Getter;

import java.util.List;

@Getter
public class BookingRulesViolatedException extends RuntimeException {

    private final List<RuleViolation> violations;

    public BookingRulesViolatedException(List<RuleViolation> violations) {
        super("Booking rejected by %d rule(s)".formatted(violations.size()));
        this.violations = List.copyOf(violations);
    }
}
