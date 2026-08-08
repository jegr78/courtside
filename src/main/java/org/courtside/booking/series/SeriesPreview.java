package org.courtside.booking.series;

import org.courtside.rules.RuleViolation;
import org.courtside.shared.TimeSlot;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public record SeriesPreview(List<Occurrence> occurrences, boolean truncatedByHorizon, LocalDate horizonLimit) {

    public SeriesPreview {
        occurrences = List.copyOf(occurrences);
    }

    public long creatableCount() {
        return occurrences.stream().filter(Occurrence::isCreatable).count();
    }

    public record Occurrence(TimeSlot slot, List<UUID> blockedCourtIds, List<RuleViolation> violations) {

        public Occurrence {
            blockedCourtIds = List.copyOf(blockedCourtIds);
            violations = List.copyOf(violations);
        }

        public boolean isCreatable() {
            return blockedCourtIds.isEmpty() && violations.isEmpty();
        }
    }
}
