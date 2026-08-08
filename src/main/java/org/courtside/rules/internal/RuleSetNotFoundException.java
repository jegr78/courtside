package org.courtside.rules.internal;

import org.courtside.shared.DomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

public class RuleSetNotFoundException extends DomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "rule-set-not-found", HttpStatus.NOT_FOUND,
            "Rule set not found", "No such rule set");

    public RuleSetNotFoundException(String message) {
        super(message);
    }


    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
