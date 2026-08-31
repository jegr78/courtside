package org.courtside.facility;

import lombok.Getter;
import org.courtside.shared.DomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.List;
import java.util.Map;

@Getter
public class WeeklyOpeningHoursRejectedException extends DomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "weekly-opening-hours-rejected", HttpStatus.BAD_REQUEST,
            "The week cannot be stored as given",
            "One or more weekdays carry a window this instance cannot store");

    private final List<OpeningHoursViolation> violations;

    WeeklyOpeningHoursRejectedException(List<OpeningHoursViolation> violations) {
        super("The week was rejected on %d weekday(s)".formatted(violations.size()));
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
