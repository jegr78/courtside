package org.courtside.booking.waitlist;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class WaitlistEntryExistsException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "waitlist-entry-exists", HttpStatus.CONFLICT,
            "Already on the waitlist", "You are already on the waitlist for this slot");

    WaitlistEntryExistsException(Throwable cause) {
        super("waitlist.entry.exists", Map.of(), cause);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
