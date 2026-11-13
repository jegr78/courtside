package org.courtside.payment.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

class PayPalHoldExpiredException extends CodedDomainFailure {

    static final ProblemType PROBLEM_TYPE = new ProblemType(
            "paypal-payment-hold-expired", HttpStatus.CONFLICT,
            "Payment time expired", "The booking's time to pay has ended");

    PayPalHoldExpiredException() {
        super("payment.paypal.holdExpired", Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
