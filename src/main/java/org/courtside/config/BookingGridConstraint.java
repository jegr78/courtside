package org.courtside.config;

import java.util.Optional;
import java.time.ZoneId;

public interface BookingGridConstraint {

    Optional<String> conflictCode(BookingSlotDuration slotDuration, ZoneId timeZone);

    default Optional<String> timeZoneConflictCode() {
        return Optional.empty();
    }
}
