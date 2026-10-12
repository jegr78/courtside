package org.courtside.shared;

import java.time.Instant;
import java.util.Collection;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

public interface WaitlistAnnouncer {

    Optional<Offer> describeOffer(UUID entryId);

    // Only the account's own entries, read in a fixed number of statements.
    Map<UUID, Offer> describeOffersOf(UUID accountId, Collection<UUID> entryIds);

    // A refused offer mail passes the account's still open offer on, since its member never learns of it.
    void offerUndeliverable(UUID entryId, UUID accountId);

    // The slot is described as a booking would be, so its wording is the booking's wording.
    record Offer(UUID accountId, BookingAnnouncement slot, Instant expiresAt, boolean open) {
    }
}
