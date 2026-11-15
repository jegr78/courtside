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

    private CurrencyChangeBlockedByCreditException(String code) {
        super(code, Map.of());
    }

    static CurrencyChangeBlockedByCreditException creditHeld() {
        return new CurrencyChangeBlockedByCreditException("config.currency.creditHeld");
    }

    static CurrencyChangeBlockedByCreditException refundPending() {
        return new CurrencyChangeBlockedByCreditException("config.currency.refundPending");
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
