package org.courtside.dataexchange;

import org.courtside.shared.DomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

public class RetentionNotConfiguredException extends DomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "retention-not-configured", HttpStatus.CONFLICT,
            "Retention not configured", "No record category has a retention period, so there is nothing to preview");

    RetentionNotConfiguredException(String message) {
        super(message);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
