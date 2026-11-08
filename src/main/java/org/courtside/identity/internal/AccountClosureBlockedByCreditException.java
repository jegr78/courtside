package org.courtside.identity.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

class AccountClosureBlockedByCreditException extends CodedDomainFailure {

    static final ProblemType PROBLEM_TYPE = new ProblemType(
            "account-closure-blocked-by-credit", HttpStatus.CONFLICT,
            "Credit balance remains", "Ask the treasurer to pay out the balance before closing the account");

    AccountClosureBlockedByCreditException() {
        super("identity.account.closureBlockedByCredit", Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
