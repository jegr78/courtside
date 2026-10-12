package org.courtside.config;

import java.time.Duration;

public record WaitlistOfferWindow(int minutes) {

    public WaitlistOfferWindow {
        if (!isValid(minutes)) {
            throw new IllegalArgumentException("A waitlist offer window must be 1 to 1440 minutes");
        }
    }

    public static boolean isValid(int minutes) {
        return minutes >= 1 && minutes <= 1440;
    }

    public Duration toDuration() {
        return Duration.ofMinutes(minutes);
    }
}
