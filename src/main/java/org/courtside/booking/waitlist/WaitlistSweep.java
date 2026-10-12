package org.courtside.booking.waitlist;

import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Profile;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.concurrent.TimeUnit;

@Component
@Profile("!journey")
@RequiredArgsConstructor
class WaitlistSweep {

    private final WaitlistQueue queue;

    @Scheduled(initialDelay = 30, timeUnit = TimeUnit.SECONDS,
            fixedDelayString = "${courtside.booking.waitlist-sweep-interval}")
    void passOnWhatIsDue() {
        queue.sweep();
    }
}
