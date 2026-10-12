package org.courtside.booking.waitlist;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class WaitlistLimitReachedException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "waitlist-limit-reached", HttpStatus.CONFLICT,
            "Waitlist limit reached", "You hold as many waitlist entries as one member may");

    WaitlistLimitReachedException(int limit) {
        super("waitlist.entry.limit", Map.of("limit", limit));
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
