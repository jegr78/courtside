package org.courtside.dataexchange;

import org.courtside.shared.DomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

public class LinkedPersonNotFoundException extends DomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "import-person-not-found", HttpStatus.NOT_FOUND,
            "Person not found", "No such person in this club's roster");

    LinkedPersonNotFoundException(String message) {
        super(message);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
