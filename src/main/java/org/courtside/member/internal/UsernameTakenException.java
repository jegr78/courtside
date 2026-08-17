package org.courtside.member.internal;

import org.courtside.shared.DomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

public class UsernameTakenException extends DomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "username-taken", HttpStatus.CONFLICT,
            "Username already in use", "This username is already in use");

    public UsernameTakenException(String message) {
        super(message);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
