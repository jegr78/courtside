package org.courtside.access.internal;

import org.courtside.config.ClubTimeZone;

import java.time.Duration;

record LoxoneSettings(LoxoneAddress address, String user, String password, ClubTimeZone zone, Duration callDeadline) {

    @Override
    public String toString() {
        return "LoxoneSettings[address=" + address + ", user=" + user + ", zone=" + zone.id() + ", callDeadline="
                + callDeadline + "]";
    }
}
