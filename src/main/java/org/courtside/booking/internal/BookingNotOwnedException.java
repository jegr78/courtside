package org.courtside.booking.internal;

import org.courtside.shared.DomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

public class BookingNotOwnedException extends DomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "booking-not-owned", HttpStatus.FORBIDDEN,
            "Not allowed", "You may only change your own bookings");

    public BookingNotOwnedException(String message) {
        super(message);
    }


    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
