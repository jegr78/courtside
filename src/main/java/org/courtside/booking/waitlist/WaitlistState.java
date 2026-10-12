package org.courtside.booking.waitlist;

public enum WaitlistState {

    WAITING,
    OFFERED,
    BOOKED,
    LEFT,
    EXPIRED,
    SKIPPED,
    ENDED;

    boolean isOpen() {
        return this == WAITING || this == OFFERED;
    }
}
