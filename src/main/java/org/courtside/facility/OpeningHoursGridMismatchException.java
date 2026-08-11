package org.courtside.facility;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class OpeningHoursGridMismatchException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "opening-hours-grid-mismatch", HttpStatus.BAD_REQUEST,
            "Opening hours do not fit the booking grid",
            "Opening and closing times must align with the booking grid");

    OpeningHoursGridMismatchException(int slotMinutes) {
        super("facility.openingHours.slotGridMismatch", Map.of("slotMinutes", slotMinutes));
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
