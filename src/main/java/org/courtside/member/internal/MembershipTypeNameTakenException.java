package org.courtside.member.internal;

import org.courtside.shared.DomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

public class MembershipTypeNameTakenException extends DomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "membership-type-name-taken", HttpStatus.CONFLICT,
            "Name already in use", "This membership type name is already in use");

    public MembershipTypeNameTakenException(String message, Throwable cause) {
        super(message, cause);
    }


    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
