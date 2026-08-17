package org.courtside.member.internal;

import org.courtside.shared.DomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

public class PersonAccountExistsException extends DomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "person-account-exists", HttpStatus.CONFLICT,
            "Account already exists", "This person already holds a user account");

    public PersonAccountExistsException(String message) {
        super(message);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
