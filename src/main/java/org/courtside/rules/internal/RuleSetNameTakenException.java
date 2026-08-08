package org.courtside.rules.internal;

import org.courtside.shared.DomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

public class RuleSetNameTakenException extends DomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "rule-set-name-taken", HttpStatus.CONFLICT,
            "Name already in use", "This rule set name is already in use");

    public RuleSetNameTakenException(String message, Throwable cause) {
        super(message, cause);
    }


    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
