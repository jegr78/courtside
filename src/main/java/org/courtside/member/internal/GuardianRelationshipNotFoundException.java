package org.courtside.member.internal;

import org.courtside.shared.DomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

public class GuardianRelationshipNotFoundException extends DomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "guardian-relationship-not-found", HttpStatus.NOT_FOUND,
            "Guardian relationship not found", "This person takes part in no such guardian relationship");

    public GuardianRelationshipNotFoundException(String message) {
        super(message);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
