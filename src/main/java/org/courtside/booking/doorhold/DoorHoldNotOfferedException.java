package org.courtside.booking.doorhold;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class DoorHoldNotOfferedException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "door-hold-not-offered", HttpStatus.CONFLICT,
            "Doors are not held open for this card", "The card of this booking does not let anyone hold its doors open");

    DoorHoldNotOfferedException() {
        super("doorHold.cardDoesNotHold", Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
