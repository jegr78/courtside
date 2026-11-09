package org.courtside.payment.internal;

public class PayPalCaptureFullyRefundedException extends RuntimeException {

    PayPalCaptureFullyRefundedException() {
        super("PayPal reports the capture as fully refunded");
    }
}
