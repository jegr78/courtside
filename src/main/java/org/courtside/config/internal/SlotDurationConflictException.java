package org.courtside.config.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

class SlotDurationConflictException extends CodedDomainFailure {

    static final ProblemType PROBLEM_TYPE = new ProblemType(
            "slot-duration-conflict", HttpStatus.CONFLICT,
            "Slot duration conflicts with bookings",
            "Existing club data does not fit the requested booking grid");

    SlotDurationConflictException(String code, int slotMinutes) {
        super(code, Map.of("slotMinutes", slotMinutes));
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
