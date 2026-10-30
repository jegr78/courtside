package org.courtside.booking.internal;

import org.courtside.shared.DomainEventRecord;
import org.jspecify.annotations.NullMarked;

import java.util.List;
import java.util.UUID;

/** A participant was answered the emergency codes of these access points; never the codes. */
@NullMarked
public record EmergencyCodeRequested(UUID bookingId, List<UUID> accessPointIds) implements DomainEventRecord {

    static final String TYPE = "booking.emergencyCode.requested";

    public EmergencyCodeRequested {
        accessPointIds = List.copyOf(accessPointIds);
    }

    @Override
    public String eventType() {
        return TYPE;
    }

    @Override
    public UUID subjectId() {
        return bookingId;
    }
}
