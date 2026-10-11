package org.courtside.shared;

import org.jspecify.annotations.NullMarked;

import java.util.List;
import java.util.UUID;

@NullMarked
public record SeriesMoved(UUID seriesId, List<UUID> bookingIds, UUID movedByAccountId)
        implements DomainEventRecord {

    static final String TYPE = "booking.series.moved";

    public SeriesMoved {
        bookingIds = List.copyOf(bookingIds);
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
