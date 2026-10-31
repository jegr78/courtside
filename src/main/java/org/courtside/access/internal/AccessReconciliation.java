package org.courtside.access.internal;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.concurrent.atomic.AtomicReference;

/** Compares the grants the system lists with the rows, at most once an hour at the end of a pass. */
@Slf4j
@Component
@ConnectorSelected
class AccessReconciliation {

    private final AtomicReference<Instant> lastRunAt = new AtomicReference<>();

    void runIfDue(PassLock lock) {
    }
}
