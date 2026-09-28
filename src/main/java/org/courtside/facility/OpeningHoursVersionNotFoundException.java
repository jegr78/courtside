package org.courtside.facility;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.time.LocalDate;
import java.util.Map;

public class OpeningHoursVersionNotFoundException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "opening-hours-version-not-found", HttpStatus.NOT_FOUND,
            "No opening hours start on that day",
            "No scheduled opening hours take effect on that day");

    OpeningHoursVersionNotFoundException(LocalDate effectiveFrom) {
        super("facility.openingHours.versionNotFound", Map.of("effectiveFrom", effectiveFrom.toString()));
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
