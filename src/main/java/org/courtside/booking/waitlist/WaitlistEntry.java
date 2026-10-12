package org.courtside.booking.waitlist;

import org.courtside.shared.TimeSlot;

import java.time.Instant;
import java.util.UUID;

public record WaitlistEntry(UUID id, UUID accountId, UUID courtId, UUID cardId, TimeSlot slot, String note,
                            WaitlistState state, Instant offerExpiresAt, UUID bookingId) {
}
