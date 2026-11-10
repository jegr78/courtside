package org.courtside.booking.internal;

import java.util.UUID;

public interface DisplacedPayments {

    /** Cancels a confirmed booking that was charged and has not started, returning the charge to credit. */
    boolean cancelCharged(UUID bookingId);
}
