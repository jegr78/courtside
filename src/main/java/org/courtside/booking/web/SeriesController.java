package org.courtside.booking.web;

import org.courtside.booking.series.CancelScope;
import org.courtside.booking.series.MovePreview;
import org.courtside.booking.series.MoveRequest;
import org.courtside.booking.series.SeriesCreationResult;
import org.courtside.booking.series.SeriesPreview;
import org.courtside.booking.series.SeriesRule;
import org.courtside.booking.series.SeriesService;
import org.courtside.booking.web.SeriesWebModels.MoveExecutedResponse;
import org.courtside.booking.web.SeriesWebModels.MovePreviewResponse;
import org.courtside.booking.web.SeriesWebModels.MoveRequestBody;
import org.courtside.booking.web.SeriesWebModels.MoveResponse;
import org.courtside.booking.web.SeriesWebModels.OccurrenceResponse;
import org.courtside.booking.web.SeriesWebModels.PreviewResponse;
import org.courtside.booking.web.SeriesWebModels.SeriesCreatedResponse;
import org.courtside.booking.web.SeriesWebModels.SeriesRuleRequest;
import org.courtside.identity.CurrentUser;
import org.courtside.identity.UserAccount;
import jakarta.validation.Valid;
import jakarta.validation.groups.Default;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

@RestController
@RequestMapping("/api/booking-series")
@RequiredArgsConstructor
class SeriesController {

    private final SeriesService series;
    private final CurrentUser currentUser;

    @PostMapping("/preview")
    PreviewResponse preview(@Valid @RequestBody SeriesRuleRequest request) {
        Optional<UserAccount> account = currentUser.account();
        SeriesPreview preview = series.preview(ruleOf(request),
                account.map(UserAccount::getId).orElse(null),
                account.map(caller -> caller.getPerson().getId()).orElse(null),
                account.map(UserAccount::getRoles).orElse(Set.of()));
        return new PreviewResponse(
                preview.occurrences().stream().map(SeriesController::toResponse).toList(),
                preview.creatableCount(), preview.truncatedByHorizon(), preview.horizonLimit());
    }

    @PostMapping
    ResponseEntity<SeriesCreatedResponse> create(
            @Validated({Default.class, SeriesRuleRequest.OnCreate.class}) @RequestBody SeriesRuleRequest request) {
        UserAccount account = currentUser.requireAccount();
        SeriesCreationResult result = series.create(
                ruleOf(request), request.confirmedStarts(),
                account.getId(), account.getPerson().getId(), account.getRoles(), request.note());

        SeriesCreatedResponse body = new SeriesCreatedResponse(
                result.seriesId(), result.bookingIds(), result.skipped());
        return result.seriesId() == null
                ? ResponseEntity.ok(body)
                : ResponseEntity.created(URI.create("/api/booking-series/" + result.seriesId()))
                        .body(body);
    }

    @DeleteMapping("/{id}")
    ResponseEntity<Void> cancel(@PathVariable UUID id,
                                @RequestParam UUID fromBookingId,
                                @RequestParam CancelScope scope) {
        UserAccount account = currentUser.requireAccount();
        series.cancel(id, fromBookingId, scope, account.getId(), account.getRoles());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{id}/move/preview")
    MovePreviewResponse previewMove(@PathVariable UUID id, @Valid @RequestBody MoveRequestBody body) {
        UserAccount account = currentUser.requireAccount();
        MovePreview preview = series.previewMove(
                moveRequestOf(id, body), account.getId(), account.getRoles());
        return new MovePreviewResponse(
                preview.moves().stream().map(SeriesController::toResponse).toList(),
                preview.isExecutable());
    }

    @PostMapping("/{id}/move")
    MoveExecutedResponse move(@PathVariable UUID id, @Valid @RequestBody MoveRequestBody body) {
        UserAccount account = currentUser.requireAccount();
        return new MoveExecutedResponse(
                series.move(moveRequestOf(id, body), account.getId(), account.getRoles()));
    }

    private static SeriesRule ruleOf(SeriesRuleRequest request) {
        return new SeriesRule(
                request.courtIds(), request.cardId(), request.startsOn(), request.startTime(),
                request.durationMinutes(), request.intervalWeeks(), request.weekdays(),
                request.endsOn(), request.occurrenceCount());
    }

    private static MoveRequest moveRequestOf(UUID seriesId, MoveRequestBody body) {
        return new MoveRequest(seriesId, body.fromBookingId(), body.scope(),
                body.newStartTime(), body.newDurationMinutes(), body.newCourtIds());
    }

    private static OccurrenceResponse toResponse(SeriesPreview.Occurrence occurrence) {
        return new OccurrenceResponse(occurrence.slot().start(), occurrence.slot().end(),
                occurrence.blockedCourtIds(), occurrence.violations(), occurrence.isCreatable());
    }

    private static MoveResponse toResponse(MovePreview.Move move) {
        return new MoveResponse(move.bookingId(), move.from().start(), move.to().start(),
                move.blockedCourtIds(), move.unbookableCourtIds(), move.violations(),
                move.isExecutable());
    }
}
