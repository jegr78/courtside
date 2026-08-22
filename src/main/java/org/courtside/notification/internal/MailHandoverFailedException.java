package org.courtside.notification.internal;

class MailHandoverFailedException extends RuntimeException {

    MailHandoverFailedException(String messageId, Throwable cause) {
        super("Handing over " + messageId + " failed", cause);
    }

    MailHandoverFailedException(String messageId, String diagnosis) {
        super("Handing over " + messageId + " failed: " + diagnosis);
    }
}
