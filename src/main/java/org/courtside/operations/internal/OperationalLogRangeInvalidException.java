package org.courtside.operations.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

class OperationalLogRangeInvalidException extends CodedDomainFailure {

    private static final ProblemType PROBLEM_TYPE = new ProblemType(
            "operational-log-range-invalid", HttpStatus.BAD_REQUEST,
            "Operational log range invalid", "The start of the range must be before its end");

    OperationalLogRangeInvalidException() {
        super("operationalLogs.range.invalid", Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
