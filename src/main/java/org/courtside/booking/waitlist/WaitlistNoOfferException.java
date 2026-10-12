package org.courtside.booking.waitlist;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class WaitlistNoOfferException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "waitlist-no-offer", HttpStatus.CONFLICT,
            "No open offer", "This waitlist entry holds no open offer");

    WaitlistNoOfferException() {
        super("waitlist.offer.none", Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
