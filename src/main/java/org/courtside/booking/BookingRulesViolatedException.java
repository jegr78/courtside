package org.courtside.booking;

import lombok.Getter;
import org.courtside.rules.RuleViolation;
import org.courtside.shared.DomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.List;
import java.util.Map;

@Getter
public class BookingRulesViolatedException extends DomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "booking-rules-violated", HttpStatus.UNPROCESSABLE_ENTITY,
            "Booking not allowed", "The booking violates one or more rules");

    private final transient List<RuleViolation> violations;

    public BookingRulesViolatedException(List<RuleViolation> violations) {
        super("Booking rejected by %d rule(s)".formatted(violations.size()));
        this.violations = List.copyOf(violations);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }

    @Override
    protected Map<String, Object> properties() {
        return Map.of("violations", violations);
    }
}
