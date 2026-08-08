package org.courtside.rules;

import java.time.Instant;
import java.util.UUID;

public interface BookingCounter {

    long countOpenBookingsOf(UUID userAccountId, Instant now);
}
