package org.courtside.card.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class ClosureCardSignalsNoOccupancyException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "closure-card-signals-no-occupancy", HttpStatus.BAD_REQUEST,
            "Closure card signals no occupancy", "A court closure never reads as an occupied court");

    public ClosureCardSignalsNoOccupancyException() {
        super("card.closure.signalsNoOccupancy", Map.of("field", "signalsOccupancy"));
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
