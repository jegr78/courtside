package org.courtside.shared;

import java.util.UUID;

/** Confirmed bookings that have not ended yet. */
public interface UpcomingBookings {

    boolean heldBy(UUID accountId);

    boolean chargedToAnyone();
}
