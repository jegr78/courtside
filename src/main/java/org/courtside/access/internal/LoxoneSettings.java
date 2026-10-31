package org.courtside.access.internal;

import java.time.Duration;

record LoxoneSettings(LoxoneAddress address, String user, String password, Duration callDeadline) {

    @Override
    public String toString() {
        return "LoxoneSettings[address=" + address + ", user=" + user + ", callDeadline="
                + callDeadline + "]";
    }
}
