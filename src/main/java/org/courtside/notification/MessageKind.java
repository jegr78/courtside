package org.courtside.notification;

// The message's own name, which is the key its template carries — not the reason another module
// had for asking, so a booking confirmation can join without the record learning about identity.
public enum MessageKind {

    // What a member may switch off is what they can miss without losing the account or being
    // written into something they never hear about.
    ACCOUNT_WELCOME("account.welcome", false, true),
    CREDENTIALS_NEW_ACCOUNT("credentials.newAccount", false, true),
    CREDENTIALS_PASSWORD_RESET("credentials.passwordReset", false, true),
    ACCOUNT_USERNAME_REMINDER("account.usernameReminder", false, true),
    ACCOUNT_PASSWORD_RESET_CODE("account.passwordResetCode", false, true),
    BOOKING_CONFIRMED("booking.confirmed", true, false),
    BOOKING_PLAYER_RECORDED("booking.playerRecorded", false, false),
    BOOKING_PLAYER_WITHDREW("booking.playerWithdrew", true, false),
    BOOKING_DISPLACED("booking.displaced", false, false),
    BOOKING_REMINDER("booking.reminder", true, false),
    BOOKING_CANCELLED("booking.cancelled", true, false),
    BOOKING_CANCELLED_BY_CLUB("booking.cancelledByClub", false, false),
    BOOKING_SERIES_CREATED("booking.seriesCreated", true, false),
    BOOKING_SERIES_CANCELLED_BY_CLUB("booking.seriesCancelledByClub", false, false),
    BOOKING_SERIES_MOVED_BY_CLUB("booking.seriesMovedByClub", false, false),
    // Joining the waitlist is the consent, and leaving it is how a member stops hearing of it.
    WAITLIST_OFFER("waitlist.offer", false, false),
    BOOKING_PARTNER_FOUND("booking.partnerFound", true, false),
    BOOKING_PLACE_TAKEN("booking.placeTaken", true, false);

    private final String templateKey;
    private final boolean declinable;
    private final boolean alwaysMailed;

    MessageKind(String templateKey, boolean declinable, boolean alwaysMailed) {
        this.templateKey = templateKey;
        this.declinable = declinable;
        this.alwaysMailed = alwaysMailed;
    }

    public String templateKey() {
        return templateKey;
    }

    public boolean isDeclinable() {
        return declinable;
    }

    // Sign-in help reaches somebody who cannot open the centre yet, so no channel choice stops it.
    public boolean isAlwaysMailed() {
        return alwaysMailed;
    }
}
