package org.courtside.payment.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

class PayPalOrderNotFoundException extends CodedDomainFailure {

    static final ProblemType PROBLEM_TYPE = new ProblemType(
            "paypal-order-not-found", HttpStatus.NOT_FOUND,
            "Payment not found", "No PayPal payment of this account awaits this booking or order");

    PayPalOrderNotFoundException() {
        super("payment.paypal.orderNotFound", Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
