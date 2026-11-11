package org.courtside.payment.internal;

/** PayPal answered that an earlier request with the same request id is still being processed. */
class PayPalRequestInProgressException extends PayPalUnavailableException {

    PayPalRequestInProgressException(String message) {
        super(message);
    }
}
