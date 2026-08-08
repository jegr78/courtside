package org.courtside.booking.internal;

import org.courtside.shared.DomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

public class BookingNotFoundException extends DomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "booking-not-found", HttpStatus.NOT_FOUND,
            "Booking not found", "No such booking");

    public BookingNotFoundException(String message) {
        super(message);
    }


    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
