package org.courtside.shared;

import org.jspecify.annotations.NullMarked;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

// The earliest moved occurrence's slot and courts before the move, which no row keeps afterwards.
@NullMarked
public record SeriesMoved(UUID seriesId, List<UUID> bookingIds, UUID movedByAccountId,
                          Instant previousStartsAt, Instant previousEndsAt, List<UUID> previousCourtIds)
        implements DomainEventRecord {

    static final String TYPE = "booking.series.moved";

    public SeriesMoved {
        bookingIds = List.copyOf(bookingIds);
        previousCourtIds = List.copyOf(previousCourtIds);
    }

    @Override
    public String eventType() {
        return TYPE;
    }

    @Override
    public UUID subjectId() {
        return seriesId;
    }
}
