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
    public ResponseEntity<ApiImpact> courtImpact(UUID courtId, UUID cursor, Integer limit) {
        return ResponseEntity.ok(toResponse(impact.ofDeactivating(courtId, cursor, limit)));
    }

    @Override
    public ResponseEntity<ApiImpact> bookingCardImpact(UUID cardId, UUID cursor, Integer limit) {
        return ResponseEntity.ok(toResponse(impact.ofRetiringCard(cardId, cursor, limit)));
    }

    @Override
    public ResponseEntity<ApiImpact> openingHoursImpact(
            ApiDayOfWeek day, LocalTime opensAt, LocalTime closesAt, UUID cursor, Integer limit) {
        DayOfWeek weekday = WireTypes.toDayOfWeek(day);
        return ResponseEntity.ok(toResponse(OpeningWindow.ofNullable(opensAt, closesAt)
                .map(window -> impact.ofOpeningHours(weekday, window, cursor, limit))
                .orElseGet(() -> impact.ofClosingWeekday(weekday, cursor, limit))));
    }

    private static ApiImpact toResponse(ImpactService.Impact impact) {
        return new ApiImpact(impact.affectedCount(), impact.truncated(),
                impact.bookings().stream().map(ImpactController::toResponse).toList())
                .nextCursor(impact.nextCursor());
    }

    private static ApiAffectedBooking toResponse(ImpactService.AffectedBooking booking) {
        return new ApiAffectedBooking(
                booking.bookingId(), booking.courtIds(),
                WireTypes.toOffsetDateTime(booking.startsAt()),
                WireTypes.toOffsetDateTime(booking.endsAt()));
    }
}
