package org.courtside.booking.internal;

import java.util.Optional;

public enum MatchType {
    SINGLES,
    DOUBLES;

    public static Optional<MatchType> ofSlotCount(long slotCount) {
        if (slotCount == 2) {
            return Optional.of(SINGLES);
        }
        return slotCount == 4 ? Optional.of(DOUBLES) : Optional.empty();
    }
}
