package org.courtside.facility;

import org.courtside.shared.OpeningWindow;
import org.jspecify.annotations.NullMarked;
import org.jspecify.annotations.Nullable;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.Map;
import java.util.UUID;

/** A season, holiday or court closure as it was before a board stored it and as it is now, without its name. */
@NullMarked
public sealed interface AvailabilityChange {

    record PeriodStored(@Nullable PeriodVersion before, PeriodVersion after) implements AvailabilityChange {

        static PeriodStored of(@Nullable OpeningPeriod before, OpeningPeriod after) {
            return new PeriodStored(before == null ? null : PeriodVersion.of(before), PeriodVersion.of(after));
        }
    }

    record ClosureStored(@Nullable ClosureVersion before, ClosureVersion after) implements AvailabilityChange {

        static ClosureStored of(@Nullable CourtClosure before, CourtClosure after) {
            return new ClosureStored(before == null ? null : ClosureVersion.of(before), ClosureVersion.of(after));
        }
    }

    record PeriodVersion(UUID id, OpeningPeriod.Kind kind, LocalDate startsOn, LocalDate endsOn,
                         Map<DayOfWeek, OpeningWindow> days) {

        public PeriodVersion {
            days = Map.copyOf(days);
        }

        static PeriodVersion of(OpeningPeriod period) {
            return new PeriodVersion(period.id(), period.kind(), period.startsOn(), period.endsOn(), period.days());
        }

        public OpeningPeriod toPeriod() {
            return new OpeningPeriod(id, kind, "", startsOn, endsOn, days);
        }
    }

    record ClosureVersion(UUID id, UUID courtId, LocalDate startsOn, LocalDate endsOn) {

        static ClosureVersion of(CourtClosure closure) {
            return new ClosureVersion(closure.id(), closure.courtId(), closure.startsOn(), closure.endsOn());
        }

        public CourtClosure toClosure() {
            return new CourtClosure(id, courtId, "", startsOn, endsOn);
        }
    }
}
