package org.courtside.card.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class ClosureCardHoldsNoDoorsException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "closure-card-holds-no-doors", HttpStatus.BAD_REQUEST,
            "Closure card holds no doors open", "A court closure never holds the doors open");

    public ClosureCardHoldsNoDoorsException() {
        super("card.closure.holdsNoDoors", Map.of("field", "holdsDoorsOpen"));
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
