package org.courtside.config;

import java.time.Duration;

public record CredentialLifetime(int hours) {

    private static final int MAXIMUM_HOURS = 168;

    public CredentialLifetime {
        if (!isValid(hours)) {
            throw new IllegalArgumentException(
                    "A credential lifetime must be 1 to " + MAXIMUM_HOURS + " hours");
        }
    }

    public static boolean isValid(int hours) {
        return hours >= 1 && hours <= MAXIMUM_HOURS;
    }

    public Duration toDuration() {
        return Duration.ofHours(hours);
    }
}
