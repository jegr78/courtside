package org.courtside.booking.doorhold;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class DoorHoldNotRunningException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "door-hold-not-running", HttpStatus.CONFLICT,
            "Doors not held open", "Nobody holds the doors of this booking open");

    DoorHoldNotRunningException() {
        super("doorHold.notRunning", Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
