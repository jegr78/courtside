package org.courtside.dataexchange;

import org.courtside.shared.DomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

public class RetentionPeriodInvalidException extends DomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "retention-period-invalid", HttpStatus.BAD_REQUEST,
            "Retention period invalid", "A retention period is a whole number of months from 1 to 1200");

    RetentionPeriodInvalidException(String message) {
        super(message);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
