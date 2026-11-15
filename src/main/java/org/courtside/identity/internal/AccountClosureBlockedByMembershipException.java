package org.courtside.identity.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

class AccountClosureBlockedByMembershipException extends CodedDomainFailure {

    static final ProblemType PROBLEM_TYPE = new ProblemType(
            "account-closure-blocked-by-membership", HttpStatus.CONFLICT,
            "Membership on record", "A person with a membership leaves through the board, not by closing the account");

    AccountClosureBlockedByMembershipException() {
        super("identity.account.closureBlockedByMembership", Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
