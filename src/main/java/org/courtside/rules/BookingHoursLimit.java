package org.courtside.rules;

import java.util.Optional;
import java.util.UUID;

public interface BookingHoursLimit {

    Optional<BookingWindow> windowFor(UUID membershipTypeId);
}
