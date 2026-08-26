package org.courtside.notification;

// The message's own name, which is the key its template carries — not the reason another module
// had for asking, so a booking confirmation can join without the record learning about identity.
public enum MessageKind {

    // What a member may switch off is what they can miss without losing the account or being
    // written into something they never hear about.
    CREDENTIALS_NEW_ACCOUNT("credentials.newAccount", false),
    CREDENTIALS_PASSWORD_RESET("credentials.passwordReset", false),
    BOOKING_CONFIRMED("booking.confirmed", true),
    BOOKING_PLAYER_RECORDED("booking.playerRecorded", false),
    BOOKING_PLAYER_WITHDREW("booking.playerWithdrew", true),
    BOOKING_DISPLACED("booking.displaced", false),
    BOOKING_REMINDER("booking.reminder", true);

    private final String templateKey;
    private final boolean declinable;

    MessageKind(String templateKey, boolean declinable) {
        this.templateKey = templateKey;
        this.declinable = declinable;
    }

    public String templateKey() {
        return templateKey;
    }

    public boolean isDeclinable() {
        return declinable;
    }
}
