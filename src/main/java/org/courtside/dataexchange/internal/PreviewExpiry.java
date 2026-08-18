package org.courtside.dataexchange.internal;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;

@Slf4j
@Component
@RequiredArgsConstructor
public class PreviewExpiry {

    private final ImportPreviewRepository previews;
    private final Clock clock;

    // The first sweep is soon after start and not one interval away: an instance that restarts more
    // often than its interval would otherwise never reach the only thing that erases.
    @Scheduled(initialDelay = 1, timeUnit = java.util.concurrent.TimeUnit.MINUTES,
            fixedDelayString = "${courtside.import.sweep-interval:PT1H}")
    @Transactional
    public void sweepNow() {
        sweep(clock.instant());
    }

    @Transactional
    public int sweep(Instant cutoff) {
        int forgotten = previews.forgetExpired(cutoff);
        log.info("Swept previews past their retention: {} lost their change set and fingerprints",
                forgotten);
        return forgotten;
    }
}
