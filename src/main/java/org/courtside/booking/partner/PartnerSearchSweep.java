package org.courtside.booking.partner;

import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Profile;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.concurrent.TimeUnit;

@Component
@Profile("!journey")
@RequiredArgsConstructor
class PartnerSearchSweep {

    private final PartnerSearchService partnerSearch;

    @Scheduled(initialDelay = 30, timeUnit = TimeUnit.SECONDS,
            fixedDelayString = "${courtside.booking.partner-sweep-interval}")
    void removeWhatNobodyCanTake() {
        partnerSearch.sweep();
    }
}
