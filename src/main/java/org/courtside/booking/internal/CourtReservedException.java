package org.courtside.booking.internal;

import org.courtside.shared.DomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

public class CourtReservedException extends DomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "court-reserved", HttpStatus.CONFLICT,
            "Court reserved", "This court is reserved for a member whose turn it is on the waitlist");

    public CourtReservedException() {
        super("One of the requested courts is reserved for a waiting member");
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
