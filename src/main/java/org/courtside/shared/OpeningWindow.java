package org.courtside.shared;

import java.time.LocalTime;
import java.util.Optional;

public record OpeningWindow(LocalTime opensAt, LocalTime closesAt) {

    public OpeningWindow {
        if (opensAt == null || closesAt == null) {
            throw new InvalidOpeningWindowException("openingWindow.incomplete",
                    "An opening window needs an opening and a closing time");
        }
        if (!closesAt.isAfter(opensAt)) {
            throw new InvalidOpeningWindowException("openingWindow.closesBeforeItOpens",
                    "A day closes after it opens");
        }
    }

    // Both absent means closed all day.
    public static Optional<OpeningWindow> ofNullable(LocalTime opensAt, LocalTime closesAt) {
        if (opensAt == null && closesAt == null) {
            return Optional.empty();
        }
        return Optional.of(new OpeningWindow(opensAt, closesAt));
    }

    public static OpeningWindow required(OpeningWindow window) {
        if (window == null) {
            throw new InvalidOpeningWindowException("openingWindow.missing",
                    "An opening window is required here");
        }
        return window;
    }

    public boolean covers(LocalTime start, LocalTime end) {
        return !start.isBefore(opensAt) && !end.isAfter(closesAt);
    }
}
