package org.courtside.dataexchange.internal;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.List;

@Slf4j
@Component
@RequiredArgsConstructor
public class PreviewExpiry {

    private final ImportPreviewRepository previews;
    private final Clock clock;

    @Scheduled(initialDelayString = "${courtside.import.sweep-interval:PT1H}",
            fixedDelayString = "${courtside.import.sweep-interval:PT1H}")
    @Transactional
    public void sweepNow() {
        sweep(clock.instant());
    }

    @Transactional
    public int sweep(Instant cutoff) {
        List<ImportPreview> expired = previews.findByExpiresAtLessThanEqualAndChangeSetIsNotNull(cutoff);
        expired.forEach(ImportPreview::forget);
        if (!expired.isEmpty()) {
            log.info("Dropped the uploaded file and the resolved change set of {} expired previews",
                    expired.size());
        }
        return expired.size();
    }
}
