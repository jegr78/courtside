package org.courtside.access.internal;

enum Action {
    NONE,
    GRANT,
    RESCHEDULE,
    REVOKE;

    boolean installs() {
        return this == GRANT || this == RESCHEDULE;
    }
}
