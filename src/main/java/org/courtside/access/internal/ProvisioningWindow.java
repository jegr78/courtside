package org.courtside.access.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.config.ClubTimeZone;
import org.courtside.rules.BookingHorizon;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;

/** A grant is inserted once its booking starts within the club's booking horizon, or 14 days without one. */
@Component
@RequiredArgsConstructor
class ProvisioningWindow {

    private static final Duration WITHOUT_ADVANCE_WINDOW = Duration.ofDays(14);

    private final BookingHorizon horizon;
    private final ClubTimeZone timeZone;

    Instant endsAt(Instant dbNow) {
        ZoneId zone = timeZone.zoneId();
        return horizon.longestAdvanceDays()
                .map(days -> dbNow.atZone(zone).toLocalDate().plusDays(days).atStartOfDay(zone).toInstant())
                .orElseGet(() -> dbNow.plus(WITHOUT_ADVANCE_WINDOW));
    }
}
