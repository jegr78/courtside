package org.courtside.notification;

import java.time.Instant;
import java.util.Optional;

public interface MailHandover {

    // Retrying means a queued message is waiting for another handover after an attempt failed.
    record Observation(Optional<Instant> lastHandedOverAt, Optional<Instant> lastFailedAt, boolean retrying,
                       String relay) {
    }

    Observation observe();
}
