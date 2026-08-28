package org.courtside.dataexchange.internal;

import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Profile;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.concurrent.TimeUnit;

@Component
@Profile("!journey")
@RequiredArgsConstructor
class PreviewExpirySchedule {

    private final PreviewExpiry expiry;

    @Scheduled(initialDelay = 1, timeUnit = TimeUnit.MINUTES,
            fixedDelayString = "${courtside.import.sweep-interval:PT1H}")
    void sweepNow() {
        expiry.sweepNow();
    }
}
