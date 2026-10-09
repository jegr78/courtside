package org.courtside.notification;

import java.time.LocalDate;
import java.util.List;

public interface MessageStatistics {

    // Retried counts the messages whose first attempt failed and that were, or wait to be, tried again.
    record KindCount(MessageKind kind, long queued, long handedOver, long refused, long failed,
                     long retried) {
    }

    List<KindCount> queuedBetween(LocalDate from, LocalDate to);
}
