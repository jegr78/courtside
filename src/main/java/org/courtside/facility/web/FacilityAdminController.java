package org.courtside.facility.web;

import org.courtside.api.AdminCourtsApi;
import org.courtside.api.AdminOpeningHoursApi;
import org.courtside.api.ApiActiveRequest;
import org.courtside.api.ApiCourt;
import org.courtside.api.ApiCourtRequest;
import org.courtside.api.ApiDayOfWeek;
import org.courtside.api.ApiOpeningHours;
import org.courtside.api.ApiSetOpeningHoursRequest;
import org.courtside.facility.Court;
import org.courtside.facility.FacilityService;
import org.courtside.facility.OpeningHours;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.WireTypes;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.time.DayOfWeek;
import java.time.LocalTime;
import java.util.List;
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
    public ResponseEntity<ApiOpeningHours> setOpeningHours(
            ApiDayOfWeek day, ApiSetOpeningHoursRequest request) {
        DayOfWeek weekday = WireTypes.toDayOfWeek(day);
        OpeningHours hours = facility.setOpeningHours(
                weekday, new OpeningWindow(request.getOpensAt(), request.getClosesAt()));
        return ResponseEntity.ok(
                toResponse(weekday, hours.getOpensAt(), hours.getClosesAt()));
    }

    @Override
    public ResponseEntity<Void> closeDay(ApiDayOfWeek day) {
        facility.closeOn(WireTypes.toDayOfWeek(day));
        return ResponseEntity.noContent().build();
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
