package org.courtside.booking.series;

import org.courtside.rules.RuleViolation;
import org.courtside.shared.TimeSlot;

import java.util.List;
import java.util.UUID;

public record MovePreview(List<Move> moves) {

    public MovePreview {
        moves = List.copyOf(moves);
    }

    public boolean isExecutable() {
        return moves.stream().allMatch(Move::isExecutable);
    }

    public record Move(UUID bookingId, TimeSlot from, TimeSlot to, List<UUID> blockedCourtIds,
                       List<UUID> unbookableCourtIds, List<RuleViolation> violations) {

        public Move {
            blockedCourtIds = List.copyOf(blockedCourtIds);
            unbookableCourtIds = List.copyOf(unbookableCourtIds);
            violations = List.copyOf(violations);
        }

        public boolean isExecutable() {
            return blockedCourtIds.isEmpty() && unbookableCourtIds.isEmpty() && violations.isEmpty();
        }
    }
}
