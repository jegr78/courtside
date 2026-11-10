package org.courtside.dataexchange;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class GuestFeePeriodIncompleteException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "guest-fee-period-incomplete", HttpStatus.BAD_REQUEST,
            "Guest fee period incomplete", "The guest fee period names only one of its two days");

    public GuestFeePeriodIncompleteException() {
        super("treasury.guestFees.periodIncomplete", Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
