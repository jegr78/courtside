package org.courtside.facility.web;

import org.courtside.facility.Court;
import org.courtside.facility.FacilityService;
import org.courtside.facility.OpeningHours;
import org.courtside.facility.web.FacilityAdminWebModels.CourtRequest;
import org.courtside.facility.web.FacilityAdminWebModels.CourtResponse;
import org.courtside.facility.web.FacilityAdminWebModels.OpeningHoursResponse;
import org.courtside.facility.web.FacilityAdminWebModels.SetOpeningHoursRequest;
import org.courtside.shared.ActiveRequest;
import org.courtside.shared.OpeningWindow;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.time.DayOfWeek;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/admin")
@RequiredArgsConstructor
class FacilityAdminController {

    private final FacilityService facility;

    @GetMapping("/courts")
    List<CourtResponse> courts() {
        return facility.allCourts().stream()
                .map(FacilityAdminController::toResponse)
                .toList();
    }

    @PostMapping("/courts")
    ResponseEntity<CourtResponse> create(@Valid @RequestBody CourtRequest request) {
        Court court = facility.createCourt(request.number(), request.name());
        return ResponseEntity
                .created(URI.create("/api/admin/courts/" + court.getId()))
                .body(toResponse(court));
    }

    @PutMapping("/courts/{id}")
    CourtResponse change(@PathVariable UUID id, @Valid @RequestBody CourtRequest request) {
        return toResponse(facility.changeCourt(id, request.number(), request.name()));
    }

    @PutMapping("/courts/{id}/active")
    CourtResponse setActive(@PathVariable UUID id, @Valid @RequestBody ActiveRequest request) {
        return toResponse(facility.setCourtActive(id, request.active()));
    }

    @GetMapping("/courts/{id}")
    CourtResponse court(@PathVariable UUID id) {
        return toResponse(facility.requireCourt(id));
    }

    @GetMapping("/opening-hours")
    List<OpeningHoursResponse> openingHours() {
        return facility.weeklyOpeningHours().stream()
                .map(hours -> new OpeningHoursResponse(
                        hours.dayOfWeek(), hours.opensAt(), hours.closesAt()))
                .toList();
    }

    @PutMapping("/opening-hours/{day}")
    OpeningHoursResponse setOpeningHours(@PathVariable DayOfWeek day,
                                         @Valid @RequestBody SetOpeningHoursRequest request) {
        OpeningHours hours = facility.setOpeningHours(
                day, new OpeningWindow(request.opensAt(), request.closesAt()));
        return new OpeningHoursResponse(day, hours.getOpensAt(), hours.getClosesAt());
    }

    @DeleteMapping("/opening-hours/{day}")
    ResponseEntity<Void> closeOn(@PathVariable DayOfWeek day) {
        facility.closeOn(day);
        return ResponseEntity.noContent().build();
    }

    private static CourtResponse toResponse(Court court) {
        return new CourtResponse(
                court.getId(), court.getNumber(), court.getName(), court.isActive());
    }
}
