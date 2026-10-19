package org.courtside.booking.internal;

import java.time.Instant;
import java.util.UUID;

public record SeriesFacts(UUID seriesId, Instant firstStartsAt, Instant lastStartsAt,
                          long occurrences, long cancelled, long past) {
}
