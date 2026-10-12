package org.courtside.booking.waitlist;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class WaitlistSlotNotTakenException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "waitlist-slot-not-taken", HttpStatus.CONFLICT,
            "Slot not taken by somebody else", "A waitlist is only for a slot somebody else holds");

    private WaitlistSlotNotTakenException(String code) {
        super(code, Map.of());
    }

    static WaitlistSlotNotTakenException free() {
        return new WaitlistSlotNotTakenException("waitlist.slot.free");
    }

    static WaitlistSlotNotTakenException own() {
        return new WaitlistSlotNotTakenException("waitlist.slot.own");
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
