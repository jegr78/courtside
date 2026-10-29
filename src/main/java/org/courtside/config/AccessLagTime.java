package org.courtside.config;

import java.time.Duration;

public record AccessLagTime(int minutes) {

    public AccessLagTime {
        if (!isValid(minutes)) {
            throw new IllegalArgumentException("An access lag time must be 0 to 240 minutes");
        }
    }

    public static boolean isValid(int minutes) {
        return minutes >= 0 && minutes <= 240;
    }

    public Duration toDuration() {
        return Duration.ofMinutes(minutes);
    }
}
