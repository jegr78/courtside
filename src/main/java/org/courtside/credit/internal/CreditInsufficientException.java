package org.courtside.credit.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

class CreditInsufficientException extends CodedDomainFailure {

    static final ProblemType PROBLEM_TYPE = new ProblemType(
            "credit-insufficient", HttpStatus.CONFLICT,
            "Credit insufficient", "The balance does not cover this amount");

    CreditInsufficientException(long balanceMinor, String currency) {
        super("credit.insufficient", Map.of("balanceMinor", balanceMinor, "currency", currency));
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
