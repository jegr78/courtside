package org.courtside.booking.internal;

import org.courtside.shared.DomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

public class CourtUnavailableException extends DomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "court-unavailable", HttpStatus.CONFLICT,
            "Court unavailable", "This court was just booked by someone else");

    public CourtUnavailableException(String message, Throwable cause) {
        super(message, cause);
    }


    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
