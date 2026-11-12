package org.courtside.booking.doorhold;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class DoorHoldAlreadyRunningException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "door-hold-already-running", HttpStatus.CONFLICT,
            "Doors already held open", "Someone else already holds the doors of this booking open");

    DoorHoldAlreadyRunningException() {
        super("doorHold.alreadyHeld", Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
