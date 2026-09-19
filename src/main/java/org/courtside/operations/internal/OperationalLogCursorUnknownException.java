package org.courtside.operations.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class OperationalLogCursorUnknownException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "operational-log-cursor-unknown", HttpStatus.BAD_REQUEST,
            "Operational log cursor unknown", "The cursor does not name an available operational log entry");

    OperationalLogCursorUnknownException() {
        super("operationalLogs.cursor.unknown", Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
