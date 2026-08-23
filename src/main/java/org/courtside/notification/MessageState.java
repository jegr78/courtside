package org.courtside.notification;

// Handing a message to the mail server is not delivery, and no state here claims otherwise:
// HANDED_OVER is where a message that went out rests, and this instance knows no more than that.
public enum MessageState {

    QUEUED,
    HANDED_OVER,
    REFUSED,
    FAILED
}
