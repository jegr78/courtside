package org.courtside.config;

import java.time.Duration;

// Minutes rather than hours, because a code that only permits replacing a password should lie in a
// mailbox for as little time as the club's own mail delivery allows.
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
