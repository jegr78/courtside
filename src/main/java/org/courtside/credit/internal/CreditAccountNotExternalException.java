package org.courtside.credit.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

class CreditAccountNotExternalException extends CodedDomainFailure {

    static final ProblemType PROBLEM_TYPE = new ProblemType(
            "credit-account-not-external", HttpStatus.CONFLICT,
            "Not an external account", "Only an external account receives credit");

    CreditAccountNotExternalException() {
        super("credit.accountNotExternal", Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
