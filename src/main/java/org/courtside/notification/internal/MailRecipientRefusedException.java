package org.courtside.notification.internal;

// The address does not exist, and it will not exist in five seconds either: this is the one failure
// the ladder must not walk, because repeating it only holds the transaction open.
class MailRecipientRefusedException extends RuntimeException {

    private final String diagnosis;
    private final String statusCode;

    MailRecipientRefusedException(String messageId, String diagnosis, String statusCode) {
        super("Handing over " + messageId + " was refused: " + diagnosis);
        this.diagnosis = diagnosis;
        this.statusCode = statusCode;
    }

    String diagnosis() {
        return diagnosis;
    }

    String statusCode() {
        return statusCode;
    }
}
