package org.courtside.shared;

import org.jspecify.annotations.NullMarked;

import java.util.List;
import java.util.UUID;

@NullMarked
public record SeriesCreated(UUID seriesId, List<UUID> bookingIds) implements DomainEventRecord {

    static final String TYPE = "booking.series.created";

    public SeriesCreated {
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
