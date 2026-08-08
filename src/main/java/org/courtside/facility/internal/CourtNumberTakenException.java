package org.courtside.facility.internal;

import org.courtside.shared.DomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

public class CourtNumberTakenException extends DomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "court-number-taken", HttpStatus.CONFLICT,
            "Court number taken", "This court number is already in use");

    public CourtNumberTakenException(String message, Throwable cause) {
        super(message, cause);
    }


    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
