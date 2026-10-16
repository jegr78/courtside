package org.courtside.facility.web;

import org.courtside.api.AdminCourtsApi;
import org.courtside.api.AdminOpeningHoursApi;
import org.courtside.api.ApiActiveRequest;
import org.courtside.api.ApiCourt;
import org.courtside.api.ApiCourtClosure;
import org.courtside.api.ApiCourtClosureRequest;
import org.courtside.api.ApiCourtRequest;
import org.courtside.api.ApiCreateCourtClosureRequest;
import org.courtside.api.ApiCreateOpeningPeriodRequest;
import org.courtside.api.ApiOpeningHours;
import org.courtside.api.ApiOpeningPeriod;
import org.courtside.api.ApiOpeningPeriodKind;
import org.courtside.api.ApiOpeningPeriodRequest;
import org.courtside.api.ApiOpeningWeek;
import org.courtside.api.ApiSetWeeklyOpeningHoursRequest;
import org.courtside.facility.Court;
import org.courtside.facility.CourtClosure;
import org.courtside.facility.FacilityService;
import org.courtside.facility.OpeningPeriod;
import org.courtside.facility.OpeningWeek;
import org.courtside.facility.internal.WeeklyOpeningHours;
import org.courtside.shared.WireTypes;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@RestController
@RequiredArgsConstructor
class FacilityAdminController implements AdminCourtsApi, AdminOpeningHoursApi {

    private final FacilityService facility;

    @Override
    public ResponseEntity<List<ApiCourt>> listCourtsForAdmin() {
        return ResponseEntity.ok(facility.allCourts().stream()
                .map(FacilityAdminController::toResponse)
                .toList());
    }

    @Override
    public ResponseEntity<ApiCourt> createCourt(ApiCourtRequest request) {
        Court court = facility.createCourt(request.getNumber(), request.getName());
        return ResponseEntity
                .created(URI.create("/api/admin/courts/" + court.getId()))
                .body(toResponse(court));
    }

    @Override
    public ResponseEntity<ApiCourt> changeCourt(UUID id, ApiCourtRequest request) {
        return ResponseEntity.ok(
                toResponse(facility.changeCourt(id, request.getNumber(), request.getName())));
    }

    @Override
    public ResponseEntity<ApiCourt> setCourtActive(UUID id, ApiActiveRequest request) {
        return ResponseEntity.ok(toResponse(facility.setCourtActive(id, request.getActive())));
    }

    @Override
    public ResponseEntity<ApiCourt> getCourt(UUID id) {
        return ResponseEntity.ok(toResponse(facility.requireCourt(id)));
    }

    @Override
    public ResponseEntity<List<ApiOpeningHours>> listOpeningHoursForAdmin() {
        return ResponseEntity.ok(facility.weeklyOpeningHours().stream()
                .map(hours -> toResponse(hours.dayOfWeek(), hours.opensAt(), hours.closesAt()))
                .toList());
    }

    @Override
    public ResponseEntity<List<ApiOpeningHours>> setWeeklyOpeningHours(
            ApiSetWeeklyOpeningHoursRequest request) {
        OpeningWeek stored = facility.scheduleOpeningHours(request.getEffectiveFrom(), toWeek(request.getDays()));
        return ResponseEntity.ok(toResponse(stored).getDays());
    }

    @Override
    public ResponseEntity<List<ApiOpeningWeek>> listOpeningScheduleForAdmin() {
        return ResponseEntity.ok(facility.openingSchedule().inForceFrom(facility.today()).stream()
                .map(FacilityAdminController::toResponse)
                .toList());
    }

    @Override
    public ResponseEntity<Void> removeScheduledOpeningHours(LocalDate effectiveFrom) {
        facility.removeScheduledOpeningHours(effectiveFrom);
        return ResponseEntity.noContent().build();
    }

    @Override
    public ResponseEntity<List<ApiOpeningPeriod>> listOpeningPeriods() {
        return ResponseEntity.ok(facility.openingPeriods().stream()
                .map(FacilityAdminController::toResponse)
                .toList());
    }

    @Override
    public ResponseEntity<ApiOpeningPeriod> createOpeningPeriod(ApiCreateOpeningPeriodRequest request) {
        OpeningPeriod period = facility.createOpeningPeriod(
                OpeningPeriod.Kind.valueOf(request.getKind().getValue()), request.getName(),
                request.getStartsOn(), request.getEndsOn(), toWeek(request.getDays()));
        return ResponseEntity
                .created(URI.create("/api/admin/opening-periods/" + period.id()))
                .body(toResponse(period));
    }

    @Override
    public ResponseEntity<ApiOpeningPeriod> changeOpeningPeriod(UUID periodId, ApiOpeningPeriodRequest request) {
        return ResponseEntity.ok(toResponse(facility.changeOpeningPeriod(periodId, request.getName(),
                request.getStartsOn(), request.getEndsOn(), toWeek(request.getDays()))));
    }

    @Override
    public ResponseEntity<Void> removeOpeningPeriod(UUID periodId) {
        facility.removeOpeningPeriod(periodId);
        return ResponseEntity.noContent().build();
    }

    @Override
    public ResponseEntity<List<ApiCourtClosure>> listCourtClosures() {
        return ResponseEntity.ok(facility.courtClosures().stream()
                .map(FacilityAdminController::toResponse)
                .toList());
    }

    @Override
    public ResponseEntity<ApiCourtClosure> createCourtClosure(ApiCreateCourtClosureRequest request) {
        CourtClosure closure = facility.createCourtClosure(
                request.getCourtId(), request.getName(), request.getStartsOn(), request.getEndsOn());
        return ResponseEntity
                .created(URI.create("/api/admin/court-closures/" + closure.id()))
                .body(toResponse(closure));
    }

    @Override
    public ResponseEntity<ApiCourtClosure> changeCourtClosure(UUID closureId, ApiCourtClosureRequest request) {
        return ResponseEntity.ok(toResponse(facility.changeCourtClosure(
                closureId, request.getName(), request.getStartsOn(), request.getEndsOn())));
    }

    @Override
    public ResponseEntity<Void> removeCourtClosure(UUID closureId) {
        facility.removeCourtClosure(closureId);
        return ResponseEntity.noContent().build();
    }

    static ApiOpeningPeriod toResponse(OpeningPeriod period) {
        return new ApiOpeningPeriod(period.id(), ApiOpeningPeriodKind.fromValue(period.kind().name()),
                period.name(), period.startsOn(), period.endsOn(), Arrays.stream(DayOfWeek.values())
                .map(day -> Optional.ofNullable(period.days().get(day))
                        .map(window -> toResponse(day, window.opensAt(), window.closesAt()))
                        .orElseGet(() -> toResponse(day, null, null)))
                .toList());
    }

    static ApiCourtClosure toResponse(CourtClosure closure) {
        return new ApiCourtClosure(
                closure.id(), closure.courtId(), closure.name(), closure.startsOn(), closure.endsOn());
    }

    private static List<WeeklyOpeningHours> toWeek(List<ApiOpeningHours> days) {
        return Optional.ofNullable(days).orElseGet(List::of).stream()
                .map(FacilityAdminController::toWeekday)
                .toList();
    }

    static ApiOpeningWeek toResponse(OpeningWeek week) {
        return new ApiOpeningWeek(week.id(), week.effectiveFrom(), Arrays.stream(DayOfWeek.values())
                .map(day -> week.windowOn(day)
                        .map(window -> toResponse(day, window.opensAt(), window.closesAt()))
                        .orElseGet(() -> toResponse(day, null, null)))
                .toList());
    }

    private static WeeklyOpeningHours toWeekday(ApiOpeningHours day) {
        return new WeeklyOpeningHours(
                WireTypes.toDayOfWeek(day.getDayOfWeek()), day.getOpensAt(), day.getClosesAt());
    }

    static ApiOpeningHours toResponse(DayOfWeek day, LocalTime opensAt, LocalTime closesAt) {
        return new ApiOpeningHours(WireTypes.toApiDayOfWeek(day))
                .opensAt(opensAt)
                .closesAt(closesAt);
    }

    private static ApiCourt toResponse(Court court) {
        return new ApiCourt(
                court.getId(), court.getNumber(), court.getName(), court.isActive());
    }
}
