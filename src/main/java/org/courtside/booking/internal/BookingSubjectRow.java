package org.courtside.booking.internal;

import java.time.Instant;
import java.util.UUID;

public record BookingSubjectRow(UUID subjectId, UUID courtId, Instant startsAt, Instant endsAt) {
}
