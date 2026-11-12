package org.courtside.config;

import java.time.Duration;

public record ReadNotificationPeriod(int days) {

    public ReadNotificationPeriod {
        if (!isValid(days)) {
            throw new IllegalArgumentException("A read notification period must be 1 to 3650 days");
        }
    }

    public static boolean isValid(int days) {
        return days >= 1 && days <= 3650;
    }

    public Duration toDuration() {
        return Duration.ofDays(days);
    }
}
