package org.courtside.notification.internal;

// The address does not exist, and it will not exist in five seconds either: this is the one failure
// the outbox does not try again.
class MailRecipientRefusedException extends RuntimeException {

    private final String diagnosis;
    private final String statusCode;
    private final boolean mailboxRefused;

    MailRecipientRefusedException(String messageId, String diagnosis, String statusCode, boolean mailboxRefused) {
        super("Handing over " + messageId + " was refused: " + diagnosis);
        this.diagnosis = diagnosis;
        this.statusCode = statusCode;
        this.mailboxRefused = mailboxRefused;
    }

    // An enhanced status 5.1.x names the address itself; a relay refusing to relay lists every recipient too.
    boolean mailboxRefused() {
        return mailboxRefused;
    }

    String diagnosis() {
        return diagnosis;
    }

    String statusCode() {
        return statusCode;
    }
}
