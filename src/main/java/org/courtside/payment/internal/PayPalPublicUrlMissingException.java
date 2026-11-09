package org.courtside.payment.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

class PayPalPublicUrlMissingException extends CodedDomainFailure {

    static final ProblemType PROBLEM_TYPE = new ProblemType(
            "paypal-public-url-missing", HttpStatus.SERVICE_UNAVAILABLE,
            "Public address missing", "PayPal needs the public address of this instance to send the payer back");

    PayPalPublicUrlMissingException() {
        super("payment.paypal.publicUrlMissing", Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
