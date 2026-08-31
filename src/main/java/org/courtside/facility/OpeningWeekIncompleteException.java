package org.courtside.facility;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class OpeningWeekIncompleteException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "opening-week-incomplete", HttpStatus.BAD_REQUEST,
            "The week is incomplete", "A week names every weekday exactly once");

    OpeningWeekIncompleteException() {
        super("facility.openingHours.weekIncomplete", Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
