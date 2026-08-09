package org.courtside.booking.web;

import org.courtside.api.ApiCancelScope;
import org.courtside.api.ApiDayOfWeek;
import org.courtside.api.ApiCreateSeriesRequest;
import org.courtside.api.ApiMove;
import org.courtside.api.ApiMoveExecuted;
import org.courtside.api.ApiMovePreview;
import org.courtside.api.ApiMoveRequest;
import org.courtside.api.ApiOccurrence;
import org.courtside.api.ApiSeriesCreated;
import org.courtside.api.ApiSeriesPreview;
import org.courtside.api.ApiSeriesRuleRequest;
import org.courtside.api.ApiViolation;
import org.courtside.api.BookingSeriesApi;
import org.courtside.booking.series.CancelScope;
import org.courtside.booking.series.MovePreview;
import org.courtside.booking.series.MoveRequest;
import org.courtside.booking.series.SeriesCreationResult;
import org.courtside.booking.series.SeriesPreview;
import org.courtside.booking.series.SeriesRule;
import org.courtside.booking.series.SeriesService;
import org.courtside.identity.CurrentUser;
import org.courtside.identity.UserAccount;
import org.courtside.rules.RuleViolation;
import org.courtside.shared.WireTypes;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.WebDataBinder;
import org.springframework.web.bind.annotation.InitBinder;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.EnumSet;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

@RestController
@RequiredArgsConstructor
class SeriesController implements BookingSeriesApi {

    private final SeriesService series;
    private final CurrentUser currentUser;
    private final SeriesRequestValidator crossFieldRules;

    @InitBinder
    void registerCrossFieldRules(WebDataBinder binder) {
        binder.addValidators(crossFieldRules);
    }

    @Override
    public ResponseEntity<ApiSeriesPreview> previewSeries(ApiSeriesRuleRequest request) {
        Optional<UserAccount> account = currentUser.account();
        SeriesPreview preview = series.preview(
                ruleOf(request.getCourtIds(), request.getCardId(), request.getStartsOn(),
                        request.getStartTime(), request.getDurationMinutes(),
                        request.getIntervalWeeks(), request.getWeekdays(), request.getEndsOn(),
                        request.getOccurrenceCount()),
                account.map(UserAccount::getId).orElse(null),
                account.map(caller -> caller.getPerson().getId()).orElse(null),
                account.map(UserAccount::getRoles).orElse(Set.of()));
        return ResponseEntity.ok(new ApiSeriesPreview(
                preview.occurrences().stream().map(SeriesController::toResponse).toList(),
                preview.creatableCount(), preview.truncatedByHorizon())
                .horizonLimit(preview.horizonLimit()));
    }

    @Override
    public ResponseEntity<ApiSeriesCreated> createSeries(ApiCreateSeriesRequest request) {
        UserAccount account = currentUser.requireAccount();
        SeriesCreationResult result = series.create(
                ruleOf(request.getCourtIds(), request.getCardId(), request.getStartsOn(),
                        request.getStartTime(), request.getDurationMinutes(),
                        request.getIntervalWeeks(), request.getWeekdays(), request.getEndsOn(),
                        request.getOccurrenceCount()),
                request.getConfirmedStarts().stream().map(WireTypes::toInstant).toList(),
                account.getId(), account.getPerson().getId(), account.getRoles(), request.getNote());

        ApiSeriesCreated body = new ApiSeriesCreated(
                result.bookingIds(),
                result.skipped().stream().map(WireTypes::toOffsetDateTime).toList())
                .seriesId(result.seriesId());
        return result.seriesId() == null
                ? ResponseEntity.ok(body)
                : ResponseEntity.created(URI.create("/api/booking-series/" + result.seriesId()))
                        .body(body);
    }

    @Override
    public ResponseEntity<Void> cancelSeries(UUID id, UUID fromBookingId, ApiCancelScope scope) {
        UserAccount account = currentUser.requireAccount();
        series.cancel(id, fromBookingId, CancelScope.valueOf(scope.getValue()),
                account.getId(), account.getRoles());
        return ResponseEntity.noContent().build();
    }

    @Override
    public ResponseEntity<ApiMovePreview> previewSeriesMove(UUID id, ApiMoveRequest body) {
        UserAccount account = currentUser.requireAccount();
        MovePreview preview = series.previewMove(
                moveRequestOf(id, body), account.getId(), account.getRoles());
        return ResponseEntity.ok(new ApiMovePreview(
                preview.moves().stream().map(SeriesController::toResponse).toList(),
                preview.isExecutable()));
    }

    @Override
    public ResponseEntity<ApiMoveExecuted> moveSeries(UUID id, ApiMoveRequest body) {
        UserAccount account = currentUser.requireAccount();
        return ResponseEntity.ok(new ApiMoveExecuted(
                series.move(moveRequestOf(id, body), account.getId(), account.getRoles())));
    }

    // Previewing and creating carry the same recurrence in two generated types — the document
    // states that creating also requires the caller's confirmation, and allOf produces two classes
    // rather than one hierarchy. The recurrence is read out once, here.
    private static SeriesRule ruleOf(Collection<UUID> courtIds, UUID cardId,
                                     LocalDate startsOn, LocalTime startTime,
                                     Integer durationMinutes, Integer intervalWeeks,
                                     Collection<ApiDayOfWeek> weekdays,
                                     LocalDate endsOn, Integer occurrenceCount) {
        return new SeriesRule(List.copyOf(courtIds), cardId, startsOn, startTime,
                durationMinutes, intervalWeeks, toWeekdays(weekdays), endsOn, occurrenceCount);
    }

    private static Set<DayOfWeek> toWeekdays(Collection<ApiDayOfWeek> weekdays) {
        return weekdays.stream().map(WireTypes::toDayOfWeek)
                .collect(Collectors.toCollection(() -> EnumSet.noneOf(DayOfWeek.class)));
    }

    private static MoveRequest moveRequestOf(UUID seriesId, ApiMoveRequest body) {
        return new MoveRequest(seriesId, body.getFromBookingId(),
                CancelScope.valueOf(body.getScope().getValue()),
                body.getNewStartTime(), body.getNewDurationMinutes(),
                body.getNewCourtIds() == null ? null : List.copyOf(body.getNewCourtIds()));
    }

    private static ApiOccurrence toResponse(SeriesPreview.Occurrence occurrence) {
        return new ApiOccurrence(
                WireTypes.toOffsetDateTime(occurrence.slot().start()),
                WireTypes.toOffsetDateTime(occurrence.slot().end()),
                occurrence.blockedCourtIds(),
                occurrence.violations().stream().map(SeriesController::toResponse).toList(),
                occurrence.isCreatable());
    }

    private static ApiMove toResponse(MovePreview.Move move) {
        return new ApiMove(move.bookingId(),
                WireTypes.toOffsetDateTime(move.from().start()),
                WireTypes.toOffsetDateTime(move.to().start()),
                move.blockedCourtIds(), move.unbookableCourtIds(),
                move.violations().stream().map(SeriesController::toResponse).toList(),
                move.isExecutable());
    }

    private static ApiViolation toResponse(RuleViolation violation) {
        return new ApiViolation(violation.code(), violation.params());
    }
}
