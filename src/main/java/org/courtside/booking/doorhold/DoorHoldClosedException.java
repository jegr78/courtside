package org.courtside.booking.doorhold;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class DoorHoldClosedException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "door-hold-closed", HttpStatus.CONFLICT,
            "Door hold closed", "The doors of this booking can be held open only from its access lead time before the start until its end");

    DoorHoldClosedException(long opensMinutesBefore) {
        super("doorHold.closed", Map.of("opensMinutesBefore", opensMinutesBefore));
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
