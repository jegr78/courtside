package org.courtside.credit.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

class CreditAccountNotFoundException extends CodedDomainFailure {

    static final ProblemType PROBLEM_TYPE = new ProblemType(
            "credit-account-not-found", HttpStatus.NOT_FOUND,
            "Account not found", "No account with this id");

    CreditAccountNotFoundException() {
        super("credit.accountNotFound", Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
