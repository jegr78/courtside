package org.courtside.access.internal;

import java.time.Duration;

/** {@code instance} is this instance's public origin, empty when unset, so two instances ask for separate tokens. */
record LoxoneSettings(LoxoneAddress address, String user, String password, Duration callDeadline, String instance) {

    LoxoneSettings(LoxoneAddress address, String user, String password, Duration callDeadline) {
        this(address, user, password, callDeadline, "");
    }

    @Override
    public String toString() {
        return "LoxoneSettings[address=" + address + ", user=" + user + ", callDeadline="
                + callDeadline + ", instance=" + instance + "]";
    }
}
