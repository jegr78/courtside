package org.courtside.identity.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

class AccountClosureBlockedByPaymentException extends CodedDomainFailure {

    static final ProblemType PROBLEM_TYPE = new ProblemType(
            "account-closure-blocked-by-payment", HttpStatus.CONFLICT,
            "PayPal payment unsettled", "Close the account once PayPal has settled the payment or refund");

    AccountClosureBlockedByPaymentException() {
        super("identity.account.closureBlockedByPayment", Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
