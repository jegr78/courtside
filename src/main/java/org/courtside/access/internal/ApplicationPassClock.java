package org.courtside.access.internal;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Instant;

@Component
@RequiredArgsConstructor
class ApplicationPassClock implements PassClock {

    private final Clock clock;

    @Override
    public Instant now() {
        return clock.instant();
    }
}
