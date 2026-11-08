package org.courtside.payment.internal;

public class PayPalRefusedException extends RuntimeException {

    private final String reason;

    PayPalRefusedException(String reason) {
        super(reason);
        this.reason = reason;
    }

    public String reason() {
        return reason;
    }
}
