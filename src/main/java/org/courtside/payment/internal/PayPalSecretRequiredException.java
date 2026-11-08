package org.courtside.payment.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

class PayPalSecretRequiredException extends CodedDomainFailure {

    static final ProblemType PROBLEM_TYPE = new ProblemType(
            "paypal-secret-required", HttpStatus.CONFLICT,
            "PayPal secret required", "PayPal needs a secret to be switched on and after its client id or environment changed");

    PayPalSecretRequiredException() {
        super("payment.paypal.secretRequired", Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
