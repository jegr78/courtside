package org.courtside.booking.internal;

import java.time.Instant;
import java.util.UUID;

record BookedSlot(UUID bookingId, UUID courtId, Instant startsAt, Instant endsAt) {
}
