package org.courtside.shared;

import org.jspecify.annotations.NullMarked;

import java.util.List;
import java.util.UUID;

@NullMarked
public record SeriesCancelled(UUID seriesId, List<UUID> bookingIds, UUID cancelledByAccountId)
        implements DomainEventRecord {

    static final String TYPE = "booking.series.cancelled";

    public SeriesCancelled {
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
