package org.courtside.dataexchange.internal;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
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
