package org.courtside.rules;

import java.util.Optional;
import java.util.UUID;

public interface WeeklyHoursLimit {

    Optional<Integer> maxHoursFor(UUID membershipTypeId);
}
