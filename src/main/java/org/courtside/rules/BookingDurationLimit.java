package org.courtside.rules;

import java.util.Optional;
import java.util.UUID;

public interface BookingDurationLimit {

    Optional<Integer> maxMinutesFor(UUID membershipTypeId);
}
