package org.courtside.rules;

import java.time.Duration;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;

public interface BookingCounter {

    long countOpenBookingsOf(UUID userAccountId, Instant now);

    Duration bookedTimeStartingBetween(UUID userAccountId, Instant from, Instant until, Set<UUID> excluded);

    boolean countsAgainstLimits(UUID cardId);
}
