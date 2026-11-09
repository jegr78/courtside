package org.courtside.payment.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

class PayPalRefundUnavailableException extends CodedDomainFailure {

    static final ProblemType PROBLEM_TYPE = new ProblemType(
            "paypal-refund-unavailable", HttpStatus.SERVICE_UNAVAILABLE,
            "PayPal refund unavailable", "PayPal is switched off or set to another environment");

    PayPalRefundUnavailableException() {
        super(PayPalRefunds.UNAVAILABLE, Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
