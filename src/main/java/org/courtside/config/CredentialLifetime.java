package org.courtside.config;

import java.time.Duration;

public record CredentialLifetime(int hours) {

    public CredentialLifetime {
        if (!isValid(hours)) {
            throw new IllegalArgumentException("A credential lifetime must be 1 to 8760 hours");
        }
    }

    public static boolean isValid(int hours) {
        return hours >= 1 && hours <= 8760;
    }

    public Duration toDuration() {
        return Duration.ofHours(hours);
    }
}
