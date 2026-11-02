package org.courtside.loxonesimulator;

import java.util.Arrays;
import java.util.Locale;
import java.util.Optional;

/** A failing Miniserver the simulator can play, named as the control listener accepts it. */
public enum Failure {
    NONE, WRONG_CREDENTIALS, MISSING_RIGHT, LOCKED_USER, DISABLED_USER, REFUSED_TOKEN, UNKNOWN_GROUP, OFFLINE;

    public String label() {
        return name().toLowerCase(Locale.ROOT).replace('_', '-');
    }

    public static Optional<Failure> named(String label) {
        return Arrays.stream(values()).filter(failure -> failure.label().equals(label.strip())).findFirst();
    }
}
