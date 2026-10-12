package org.courtside.booking.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class CancellationReasonNotAllowedException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "cancellation-reason-not-allowed", HttpStatus.BAD_REQUEST,
            "Cancellation reason not allowed", "Only somebody cancelling another holder's booking names a reason");

    public CancellationReasonNotAllowedException() {
        super("booking.cancellationReason.ownBooking", Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
