package org.courtside.booking.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class CancellationReasonNotAllowedException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "cancellation-reason-not-allowed", HttpStatus.BAD_REQUEST,
            "Cancellation reason not allowed", "This cancellation cannot name that reason");

    public CancellationReasonNotAllowedException() {
        this("booking.cancellationReason.ownBooking");
    }

    private CancellationReasonNotAllowedException(String code) {
        super(code, Map.of());
    }

    public static CancellationReasonNotAllowedException reserved() {
        return new CancellationReasonNotAllowedException("booking.cancellationReason.reserved");
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
