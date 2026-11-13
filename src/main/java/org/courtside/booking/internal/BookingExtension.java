package org.courtside.booking.internal;

import org.courtside.identity.Role;

import java.time.Instant;
import java.util.Set;
import java.util.UUID;

public interface BookingExtension {

    /** Moves a locked, confirmed booking's end to {@code endsAt} under the rules that bind its booker. */
    void extend(UUID bookingId, Instant endsAt, UUID extendedBy, Set<Role> extenderRoles);
}
