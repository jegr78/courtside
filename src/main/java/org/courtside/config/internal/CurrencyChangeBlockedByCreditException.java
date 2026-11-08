package org.courtside.config.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

class CurrencyChangeBlockedByCreditException extends CodedDomainFailure {

    static final ProblemType PROBLEM_TYPE = new ProblemType(
            "currency-change-blocked-by-credit", HttpStatus.CONFLICT,
            "Credit held in the current currency",
            "Pay out every credit balance before changing the club currency");

    CurrencyChangeBlockedByCreditException() {
        super("config.currency.creditHeld", Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
