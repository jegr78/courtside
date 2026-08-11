package org.courtside.config;

import java.util.Optional;

public interface BookingGridConstraint {

    Optional<String> conflictCode(BookingSlotDuration slotDuration);
}
