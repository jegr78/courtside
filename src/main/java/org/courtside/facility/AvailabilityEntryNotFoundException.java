package org.courtside.facility;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class AvailabilityEntryNotFoundException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "availability-entry-not-found", HttpStatus.NOT_FOUND,
            "No such season, holiday or court closure",
            "No season, holiday or court closure has that id");

    public AvailabilityEntryNotFoundException() {
        super("facility.availability.notFound", Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
