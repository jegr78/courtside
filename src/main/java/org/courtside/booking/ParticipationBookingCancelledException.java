package org.courtside.booking;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class ParticipationBookingCancelledException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "participation-booking-cancelled", HttpStatus.CONFLICT,
            "Booking cancelled", "This booking is cancelled, so there is nothing to withdraw from");

    ParticipationBookingCancelledException() {
        super("participation.bookingCancelled", Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
