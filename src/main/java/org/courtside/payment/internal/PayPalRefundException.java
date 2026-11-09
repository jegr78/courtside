package org.courtside.payment.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

class PayPalRefundException extends CodedDomainFailure {

    static final ProblemType PROBLEM_TYPE = new ProblemType(
            "paypal-refund-refused", HttpStatus.CONFLICT,
            "PayPal refund refused", "This PayPal payment cannot be returned through PayPal");

    private PayPalRefundException(String code, Map<String, Object> params) {
        super(code, params);
    }

    static PayPalRefundException notRefundable() {
        return new PayPalRefundException(PayPalRefunds.NOT_REFUNDABLE, Map.of());
    }

    static PayPalRefundException alreadyRefunded() {
        return new PayPalRefundException(PayPalRefunds.ALREADY_REFUNDED, Map.of());
    }

    static PayPalRefundException creditSpent(int amountMinor, long balanceMinor, String currency) {
        return new PayPalRefundException(PayPalRefunds.CREDIT_SPENT,
                Map.of("amountMinor", amountMinor, "balanceMinor", balanceMinor, "currency", currency));
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
