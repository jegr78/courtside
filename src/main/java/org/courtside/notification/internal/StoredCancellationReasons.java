package org.courtside.notification.internal;

import org.courtside.shared.CancellationReason;

import java.util.Arrays;

final class StoredCancellationReasons {

    private StoredCancellationReasons() {
    }

    // An entry stored with a code this version no longer knows reads as one that names none.
    static CancellationReason of(String stored) {
        return Arrays.stream(CancellationReason.values())
                .filter(reason -> reason.name().equals(stored))
                .findFirst()
                .orElse(null);
    }
}
