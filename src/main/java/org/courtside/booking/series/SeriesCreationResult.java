package org.courtside.booking.series;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record SeriesCreationResult(UUID seriesId, List<UUID> bookingIds, List<Instant> skipped) {

    public SeriesCreationResult {
        bookingIds = List.copyOf(bookingIds);
        skipped = List.copyOf(skipped);
    }
}
