package org.courtside.notification.internal;

class MailHandoverFailedException extends RuntimeException {

    MailHandoverFailedException(String messageId, Throwable cause) {
        super("Handing over " + messageId + " failed", cause);
    }
}
