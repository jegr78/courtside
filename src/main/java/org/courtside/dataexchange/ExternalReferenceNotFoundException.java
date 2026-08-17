package org.courtside.dataexchange;

import org.courtside.shared.DomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

public class ExternalReferenceNotFoundException extends DomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "import-external-reference-not-found", HttpStatus.NOT_FOUND,
            "External reference not found", "This source does not link that member number to anybody");

    ExternalReferenceNotFoundException(String message) {
        super(message);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
