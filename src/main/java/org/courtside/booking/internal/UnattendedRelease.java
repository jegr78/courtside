package org.courtside.booking.internal;

import java.util.UUID;

public interface UnattendedRelease {

    /** Frees the courts of a started booking nobody checked in for; false when it no longer is one. */
    boolean release(UUID bookingId);
}
