package org.courtside.access.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.config.ClubTimeZone;
import org.courtside.rules.BookingHorizon;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;

/** A grant is inserted once its booking starts before the end of the club's booking horizon. */
@Component
@RequiredArgsConstructor
class ProvisioningWindow {

    // Without an advance window every booking is provisioned at once; a database cannot hold Instant.MAX.
    private static final Duration UNBOUNDED = Duration.ofDays(36_525);

    private final BookingHorizon horizon;
    private final ClubTimeZone timeZone;

    Instant endsAt(Instant dbNow) {
        ZoneId zone = timeZone.zoneId();
        return horizon.longestAdvanceDays()
                .map(days -> dbNow.atZone(zone).toLocalDate().plusDays(days).atStartOfDay(zone).toInstant())
                .orElseGet(() -> dbNow.plus(UNBOUNDED));
    }
}
