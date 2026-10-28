package org.courtside.notification;

public enum MessageKind {

    ACCOUNT_WELCOME("account.welcome", false, true),
    CREDENTIALS_NEW_ACCOUNT("credentials.newAccount", false, true),
    CREDENTIALS_PASSWORD_RESET("credentials.passwordReset", false, true),
    ACCOUNT_USERNAME_REMINDER("account.usernameReminder", false, true),
    ACCOUNT_PASSWORD_RESET_CODE("account.passwordResetCode", false, true),
    ACCOUNT_SECURITY_CHANGED("account.securityChanged", false, true),
    ACCOUNT_MFA_RECOVERY_CODE("account.mfaRecoveryCode", false, true),
    ACCOUNT_FACTOR_GUESSING_BLOCKED("account.factorGuessingBlocked", false, true),
    BOOKING_CONFIRMED("booking.confirmed", true, false),
    BOOKING_PLAYER_RECORDED("booking.playerRecorded", false, false),
    BOOKING_PLAYER_WITHDREW("booking.playerWithdrew", true, false),
    BOOKING_DISPLACED("booking.displaced", false, false),
    BOOKING_REMINDER("booking.reminder", true, false),
    BOOKING_CANCELLED("booking.cancelled", true, false),
    BOOKING_CANCELLED_BY_CLUB("booking.cancelledByClub", false, false),
    BOOKING_RELEASED("booking.released", false, false),
    BOOKING_SERIES_CREATED("booking.seriesCreated", true, false),
    BOOKING_SERIES_CANCELLED_BY_CLUB("booking.seriesCancelledByClub", false, false),
    BOOKING_SERIES_MOVED_BY_CLUB("booking.seriesMovedByClub", false, false),
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

    public boolean isAlwaysMailed() {
        return alwaysMailed;
    }
}
