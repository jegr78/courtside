package org.courtside.shared;

import java.util.Collection;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

public interface BookingAnnouncer {

    Optional<BookingAnnouncement> describe(UUID bookingId);

    // Only bookings the account owns or currently plays in, read in a fixed number of statements.
    Map<UUID, BookingAnnouncement> describeVisibleTo(UUID accountId, UUID personId, Collection<UUID> bookingIds);
}
