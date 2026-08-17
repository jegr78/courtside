package org.courtside.dataexchange;

import org.courtside.shared.DomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

public class PersonAlreadyLinkedException extends DomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "import-person-already-linked", HttpStatus.CONFLICT,
            "Person already linked", "This source already knows that person under another member number");

    PersonAlreadyLinkedException(String message, Throwable cause) {
        super(message, cause);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
