package org.courtside.booking.web;

import org.courtside.booking.internal.ImpactService;
import org.courtside.booking.web.ImpactWebModels.AffectedBookingResponse;
import org.courtside.booking.web.ImpactWebModels.ImpactResponse;
import org.courtside.shared.OpeningWindow;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.DayOfWeek;
import java.time.LocalTime;
import java.util.UUID;

@RestController
@RequestMapping("/api/admin/impact")
@RequiredArgsConstructor
class ImpactController {

    private final ImpactService impact;

    @GetMapping("/courts/{courtId}")
    ImpactResponse ofDeactivatingCourt(@PathVariable UUID courtId) {
        return toResponse(impact.ofDeactivating(courtId));
    }

    @GetMapping("/booking-cards/{cardId}")
    ImpactResponse ofRetiringCard(@PathVariable UUID cardId) {
        return toResponse(impact.ofRetiringCard(cardId));
    }

    @GetMapping("/opening-hours/{day}")
    ImpactResponse ofOpeningHours(@PathVariable DayOfWeek day,
            @RequestParam(required = false) LocalTime opensAt,
            @RequestParam(required = false) LocalTime closesAt) {
        return toResponse(OpeningWindow.ofNullable(opensAt, closesAt)
                .map(window -> impact.ofOpeningHours(day, window))
                .orElseGet(() -> impact.ofClosingWeekday(day)));
    }

    private static ImpactResponse toResponse(ImpactService.Impact impact) {
        return new ImpactResponse(impact.affectedCount(), impact.truncated(),
                impact.bookings().stream().map(ImpactController::toResponse).toList());
    }

    private static AffectedBookingResponse toResponse(ImpactService.AffectedBooking booking) {
        return new AffectedBookingResponse(
                booking.bookingId(), booking.courtIds(), booking.startsAt(), booking.endsAt());
    }
}
