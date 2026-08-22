package org.courtside.notification.internal;

class MailHandoverInterruptedException extends RuntimeException {

    MailHandoverInterruptedException(InterruptedException cause) {
        super("The handover was interrupted before the mail server answered", cause);
    }
}
