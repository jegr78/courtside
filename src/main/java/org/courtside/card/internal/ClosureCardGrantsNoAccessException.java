package org.courtside.card.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class ClosureCardGrantsNoAccessException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "closure-card-grants-no-access", HttpStatus.BAD_REQUEST,
            "Closure card grants no access", "A court closure never hands out access codes");

    public ClosureCardGrantsNoAccessException() {
        super("card.closure.grantsNoAccess", Map.of("field", "grantsAccess"));
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
