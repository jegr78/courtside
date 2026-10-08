package org.courtside.notification.internal;

// What the message was about, or who it was for, is gone, and no later attempt can write it.
class MessageUndeliverableException extends RuntimeException {

    private final String reason;

    MessageUndeliverableException(String reason) {
        super("The message cannot be written: " + reason);
        this.reason = reason;
    }

    String reason() {
        return reason;
    }
}
