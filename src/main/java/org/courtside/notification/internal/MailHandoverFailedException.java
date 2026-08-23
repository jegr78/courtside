package org.courtside.notification.internal;

class MailHandoverFailedException extends RuntimeException {

    private final String diagnosis;

    MailHandoverFailedException(String messageId, Throwable cause) {
        super("Handing over " + messageId + " failed", cause);
        this.diagnosis = cause.getClass().getSimpleName();
    }

    MailHandoverFailedException(String messageId, String diagnosis) {
        super("Handing over " + messageId + " failed: " + diagnosis);
        this.diagnosis = diagnosis;
    }

    String diagnosis() {
        return diagnosis;
    }
}
