package org.courtside.shared;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.SequencedMap;
import java.util.UUID;

public interface BookingAnnouncer {

    Optional<BookingAnnouncement> describe(UUID bookingId);

    // Only bookings the account owns or currently plays in, read in a fixed number of statements.
    Map<UUID, BookingAnnouncement> describeVisibleTo(UUID accountId, UUID personId, Collection<UUID> bookingIds);

    // Cancelled ones included, earliest first, and an id naming no booking is left out.
    SequencedMap<UUID, BookingAnnouncement> describeAll(Collection<UUID> bookingIds);

    // In the order given, and a court that no longer exists is left out.
    List<BookingAnnouncement.AnnouncedCourt> describeCourts(List<UUID> courtIds);

    // The occurrences still confirmed, earliest first.
    List<BookingAnnouncement> describeSeries(UUID seriesId);
}
