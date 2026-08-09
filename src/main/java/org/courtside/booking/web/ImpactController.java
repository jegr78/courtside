package org.courtside.booking.web;

import org.courtside.api.AdminImpactApi;
import org.courtside.api.ApiAffectedBooking;
import org.courtside.api.ApiDayOfWeek;
import org.courtside.api.ApiImpact;
import org.courtside.booking.internal.ImpactService;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.WireTypes;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.time.DayOfWeek;
import java.time.LocalTime;
import java.util.UUID;

@RestController
@RequiredArgsConstructor
class ImpactController implements AdminImpactApi {

    private final ImpactService impact;

    @Override
    public ResponseEntity<ApiImpact> courtImpact(UUID courtId) {
        return ResponseEntity.ok(toResponse(impact.ofDeactivating(courtId)));
    }

    @Override
    public ResponseEntity<ApiImpact> bookingCardImpact(UUID cardId) {
        return ResponseEntity.ok(toResponse(impact.ofRetiringCard(cardId)));
    }

    @Override
    public ResponseEntity<ApiImpact> openingHoursImpact(
            ApiDayOfWeek day, LocalTime opensAt, LocalTime closesAt) {
        DayOfWeek weekday = WireTypes.toDayOfWeek(day);
        return ResponseEntity.ok(toResponse(OpeningWindow.ofNullable(opensAt, closesAt)
                .map(window -> impact.ofOpeningHours(weekday, window))
                .orElseGet(() -> impact.ofClosingWeekday(weekday))));
    }

    private static ApiImpact toResponse(ImpactService.Impact impact) {
        return new ApiImpact(impact.affectedCount(), impact.truncated(),
                impact.bookings().stream().map(ImpactController::toResponse).toList());
    }

    private static ApiAffectedBooking toResponse(ImpactService.AffectedBooking booking) {
        return new ApiAffectedBooking(
                booking.bookingId(), booking.courtIds(),
                WireTypes.toOffsetDateTime(booking.startsAt()),
                WireTypes.toOffsetDateTime(booking.endsAt()));
    }
}
