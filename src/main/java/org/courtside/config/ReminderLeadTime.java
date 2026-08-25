package org.courtside.config;

public record ReminderLeadTime(int hours) {

    public ReminderLeadTime {
        if (!isValid(hours)) {
            throw new IllegalArgumentException("A reminder lead time must be 0 to 168 hours");
        }
    }

    public static boolean isValid(int hours) {
        return hours >= 0 && hours <= 168;
    }

    public boolean isOff() {
        return hours == 0;
    }
}
