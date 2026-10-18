package org.courtside.booking.internal;

import org.courtside.shared.DomainFailure;
import org.courtside.shared.ProblemType;

/** A guardian named a booking the dependant does not hold; answered like an unknown booking. */
public class DependantBookingNotHeldException extends DomainFailure {

    public static final ProblemType PROBLEM_TYPE = BookingNotFoundException.PROBLEM_TYPE;

    public DependantBookingNotHeldException(String message) {
        super(message);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }

    @Override
    public boolean refusesAuthorization() {
        return true;
    }
}
