package org.courtside.booking.waitlist;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class WaitlistEntryNotFoundException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "waitlist-entry-not-found", HttpStatus.NOT_FOUND,
            "Waitlist entry not found", "No waitlist entry with this id is yours");

    WaitlistEntryNotFoundException() {
        super("waitlist.entry.notFound", Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
