package org.courtside.identity.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

class AccountClosureBlockedByBookingException extends CodedDomainFailure {

    static final ProblemType PROBLEM_TYPE = new ProblemType(
            "account-closure-blocked-by-booking", HttpStatus.CONFLICT,
            "Upcoming booking", "Cancel the upcoming booking before closing the account");

    AccountClosureBlockedByBookingException() {
        super("identity.account.closureBlockedByBooking", Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
