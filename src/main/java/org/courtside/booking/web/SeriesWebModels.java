package org.courtside.booking.web;

import org.courtside.booking.series.CancelScope;
import org.courtside.booking.series.SeriesRule;
import org.courtside.rules.RuleViolation;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import org.courtside.shared.NoDuplicates;
import org.courtside.shared.NotEmptyIfGiven;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;

final class SeriesWebModels {

    private SeriesWebModels() {
    }

    record SeriesRuleRequest(
            @NotEmpty @NoDuplicates List<UUID> courtIds,
            @NotNull UUID cardId,
            @NotNull LocalDate startsOn,
            @NotNull LocalTime startTime,
            @Positive @Max(SeriesRule.MAX_DURATION_MINUTES) int durationMinutes,
            @Positive @Max(SeriesRule.MAX_INTERVAL_WEEKS) int intervalWeeks,
            @NotEmpty Set<DayOfWeek> weekdays,
            LocalDate endsOn,
            @Positive @Max(SeriesRule.MAX_OCCURRENCES) Integer occurrenceCount,
            String note,
            @NotEmpty(groups = OnCreate.class) @NoDuplicates List<Instant> confirmedStarts) {

        interface OnCreate {
        }
    }

    record PreviewResponse(List<OccurrenceResponse> occurrences, long creatableCount,
                           boolean truncatedByHorizon, LocalDate horizonLimit) {
    }

    record OccurrenceResponse(Instant startsAt, Instant endsAt, List<UUID> blockedCourtIds,
                              List<RuleViolation> violations, boolean creatable) {
    }

    record SeriesCreatedResponse(UUID seriesId, List<UUID> bookingIds, List<Instant> skipped) {
    }

    record MoveRequestBody(
            @NotNull UUID fromBookingId,
            @NotNull CancelScope scope,
            LocalTime newStartTime,
            @Positive Integer newDurationMinutes,
            @NotEmptyIfGiven @NoDuplicates List<UUID> newCourtIds) {
    }

    record MovePreviewResponse(List<MoveResponse> moves, boolean executable) {
    }

    record MoveResponse(UUID bookingId, Instant fromStartsAt, Instant toStartsAt,
                        List<UUID> blockedCourtIds, List<UUID> unbookableCourtIds,
                        List<RuleViolation> violations, boolean executable) {
    }

    record MoveExecutedResponse(int moved) {
    }
}
