package org.courtside.notification;

// The message's own name, which is the key its template carries — not the reason another module
// had for asking, so a booking confirmation can join without the record learning about identity.
public enum MessageKind {

    CREDENTIALS_NEW_ACCOUNT("credentials.newAccount"),
    CREDENTIALS_PASSWORD_RESET("credentials.passwordReset"),
    BOOKING_CONFIRMED("booking.confirmed"),
    BOOKING_PLAYER_RECORDED("booking.playerRecorded"),
    BOOKING_PLAYER_WITHDREW("booking.playerWithdrew"),
    BOOKING_DISPLACED("booking.displaced"),
    BOOKING_REMINDER("booking.reminder");

    private final String templateKey;

    MessageKind(String templateKey) {
        this.templateKey = templateKey;
    }

    public String templateKey() {
        return templateKey;
    }
}
