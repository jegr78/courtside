package org.courtside.booking.web;

import lombok.RequiredArgsConstructor;
import org.courtside.api.AdminReportsApi;
import org.courtside.api.ApiCourtUtilisation;
import org.courtside.api.ApiFacilityUtilisation;
import org.courtside.booking.internal.FacilityUtilisationService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;

@RestController
@RequiredArgsConstructor
class FacilityUtilisationController implements AdminReportsApi {

    private final FacilityUtilisationService utilisation;

    @Override
    public ResponseEntity<ApiFacilityUtilisation> facilityUtilisation(LocalDate from, LocalDate to) {
        FacilityUtilisationService.FacilityUtilisation report = utilisation.report(from, to);
        return ResponseEntity.ok(new ApiFacilityUtilisation(
                report.from(), report.to(), report.timeZone(), report.courts().stream()
                .map(court -> new ApiCourtUtilisation(
                        court.courtId(), court.courtNumber(), court.courtName(),
                        court.bookingCount(), court.occupiedMinutes()))
                .toList()));
    }
}
