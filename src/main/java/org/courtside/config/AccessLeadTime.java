package org.courtside.config;

import java.time.Duration;

public record AccessLeadTime(int minutes) {

    public AccessLeadTime {
        if (!isValid(minutes)) {
            throw new IllegalArgumentException("An access lead time must be 0 to 240 minutes");
        }
    }

    public static boolean isValid(int minutes) {
        return minutes >= 0 && minutes <= 240;
    }

    public Duration toDuration() {
        return Duration.ofMinutes(minutes);
    }
}
