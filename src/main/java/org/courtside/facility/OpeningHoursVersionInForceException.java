package org.courtside.facility;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.time.LocalDate;
import java.util.Map;

public class OpeningHoursVersionInForceException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "opening-hours-version-in-force", HttpStatus.CONFLICT,
            "These opening hours are already in force",
            "Opening hours in force are replaced from a later day, not removed");

    OpeningHoursVersionInForceException(LocalDate effectiveFrom) {
        super("facility.openingHours.versionInForce", Map.of("effectiveFrom", effectiveFrom.toString()));
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
