package org.courtside.notification;

import java.time.LocalDate;
import java.util.List;

public interface MessageStatistics {

    record KindCount(MessageKind kind, long queued, long handedOver, long refused, long failed) {
    }

    List<KindCount> queuedBetween(LocalDate from, LocalDate to);
}
