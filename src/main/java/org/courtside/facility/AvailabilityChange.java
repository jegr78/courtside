package org.courtside.facility;

import org.jspecify.annotations.NullMarked;
import org.jspecify.annotations.Nullable;

/** A season, holiday or court closure as it was before a board stored it and as it is now. */
@NullMarked
public sealed interface AvailabilityChange {

    record PeriodStored(@Nullable OpeningPeriod before, OpeningPeriod after) implements AvailabilityChange {
    }

    record ClosureStored(@Nullable CourtClosure before, CourtClosure after) implements AvailabilityChange {
    }
}
