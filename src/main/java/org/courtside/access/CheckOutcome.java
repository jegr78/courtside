package org.courtside.access;

/** What a connection check came to; {@code MANUAL} is a check only a person at the door can make. */
public enum CheckOutcome {
    PASSED, FAILED, SKIPPED, MANUAL
}
