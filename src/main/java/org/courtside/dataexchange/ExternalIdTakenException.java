package org.courtside.dataexchange;

import org.courtside.shared.DomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

public class ExternalIdTakenException extends DomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "import-external-id-taken", HttpStatus.CONFLICT,
            "External id taken", "This source already links that member number to somebody else");

    ExternalIdTakenException(String message, Throwable cause) {
        super(message, cause);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
