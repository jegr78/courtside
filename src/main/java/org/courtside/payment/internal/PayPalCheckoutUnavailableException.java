package org.courtside.payment.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

class PayPalCheckoutUnavailableException extends CodedDomainFailure {

    static final ProblemType PROBLEM_TYPE = new ProblemType(
            "paypal-unavailable", HttpStatus.SERVICE_UNAVAILABLE,
            "PayPal unavailable", "PayPal could not start the payment");

    PayPalCheckoutUnavailableException() {
        super("payment.paypal.unavailable", Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
