package org.courtside.access.internal;

import java.time.Duration;
import java.time.ZoneId;

record LoxoneSettings(LoxoneAddress address, String user, String password, ZoneId zone, Duration callDeadline) {

    @Override
    public String toString() {
        return "LoxoneSettings[address=" + address + ", user=" + user + ", zone=" + zone + ", callDeadline="
                + callDeadline + "]";
    }
}
