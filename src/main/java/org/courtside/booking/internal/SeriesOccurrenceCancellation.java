package org.courtside.booking.internal;

import org.courtside.identity.Role;
import org.courtside.shared.CancellationReason;

import java.util.Set;
import java.util.UUID;

// Cancels one occurrence without announcing it, because the series change announces all of them.
public interface SeriesOccurrenceCancellation {

    void cancelOccurrence(UUID bookingId, UUID cancelledBy, Set<Role> cancellerRoles,
                          CancellationReason reason);
}
