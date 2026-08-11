package org.courtside.config;

import java.time.Duration;
import java.time.LocalTime;

public record BookingSlotDuration(int minutes) {

    public BookingSlotDuration {
        if (!isValid(minutes)) {
            throw new IllegalArgumentException(
                    "Booking slot duration must be 5 to 120 minutes in five-minute steps");
        }
    }

    public static boolean isValid(int minutes) {
        return minutes >= 5 && minutes <= 120 && minutes % 5 == 0;
    }

    public boolean isAligned(LocalTime time) {
        return time.getNano() == 0 && time.toSecondOfDay() % seconds() == 0;
    }

    public boolean containsWholeSlots(Duration duration) {
        return duration.getNano() == 0 && duration.toSeconds() % seconds() == 0;
    }

    public int seconds() {
        return minutes * 60;
    }
}
