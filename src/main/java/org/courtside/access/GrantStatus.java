package org.courtside.access;

/** What an access grant is doing, in the precedence a board reads it: failing first, done last. */
public enum GrantStatus {
    FAILING,
    REMOVING,
    INSTALLED,
    WAITING,
    DONE
}
