package org.courtside.shared;

import java.util.Optional;
import java.util.UUID;

public interface BookingAnnouncer {

    Optional<BookingAnnouncement> describe(UUID bookingId);
}
