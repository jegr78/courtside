package org.courtside.payment.internal;

public class PayPalRefundRefusedException extends RuntimeException {

    private final String reason;

    PayPalRefundRefusedException(String reason) {
        super(reason);
        this.reason = reason;
    }

    public String reason() {
        return reason;
    }
}
