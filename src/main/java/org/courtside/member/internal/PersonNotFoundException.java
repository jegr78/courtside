package org.courtside.member.internal;

import org.courtside.shared.DomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

public class PersonNotFoundException extends DomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "person-not-found", HttpStatus.NOT_FOUND,
            "Person not found", "No such person");

    public PersonNotFoundException(String message) {
        super(message);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
