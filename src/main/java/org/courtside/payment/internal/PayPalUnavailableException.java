package org.courtside.payment.internal;

public class PayPalUnavailableException extends RuntimeException {

    PayPalUnavailableException(String message, Throwable cause) {
        super(message, cause);
    }

    PayPalUnavailableException(String message) {
        super(message);
    }
}
