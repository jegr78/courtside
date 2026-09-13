package org.courtside.config;

import java.time.Duration;

public record ResetTokenLifetime(int minutes) {

    public static final int SHORTEST_MINUTES = 15;
    public static final int LONGEST_MINUTES = 1440;

    public ResetTokenLifetime {
        if (minutes < SHORTEST_MINUTES || minutes > LONGEST_MINUTES) {
            throw new IllegalArgumentException("A reset code stays redeemable between "
                    + SHORTEST_MINUTES + " and " + LONGEST_MINUTES + " minutes, not " + minutes);
        }
    }

    public Duration toDuration() {
        return Duration.ofMinutes(minutes);
    }
}
