package org.courtside.access.internal;

final class NoFreeAccessCodeException extends IllegalStateException {

    NoFreeAccessCodeException(int digits, int draws) {
        super("No free access code of " + digits + " digits after " + draws + " draws");
    }
}
