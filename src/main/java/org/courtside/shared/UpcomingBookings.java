package org.courtside.shared;

import java.util.UUID;

/** Whether an account holds a confirmed booking of its own that has not ended yet. */
public interface UpcomingBookings {

    boolean heldBy(UUID accountId);
}
