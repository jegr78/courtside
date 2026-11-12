package org.courtside.booking.doorhold;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class DoorHoldNotHolderException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "door-hold-not-holder", HttpStatus.FORBIDDEN,
            "Not the door holder", "Only the person who checked in or an administrator ends a door hold");

    DoorHoldNotHolderException() {
        super("doorHold.notHolder", Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
