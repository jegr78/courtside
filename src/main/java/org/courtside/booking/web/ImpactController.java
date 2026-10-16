package org.courtside.booking.web;

import org.courtside.api.AdminImpactApi;
import org.courtside.api.ApiAffectedBooking;
import org.courtside.api.ApiCourtClosureImpactRequest;
import org.courtside.api.ApiDayOfWeek;
import org.courtside.api.ApiImpact;
import org.courtside.api.ApiOpeningHours;
import org.courtside.api.ApiOpeningPeriodImpactRequest;
import org.courtside.booking.internal.ImpactService;
import org.courtside.facility.OpeningPeriod;
import org.courtside.facility.OpeningWeekIncompleteException;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.WireTypes;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
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
    public ResponseEntity<ApiImpact> openingHoursImpact(ApiDayOfWeek day, LocalDate effectiveFrom,
            LocalTime opensAt, LocalTime closesAt, UUID cursor, Integer limit) {
        DayOfWeek weekday = WireTypes.toDayOfWeek(day);
        return ResponseEntity.ok(toResponse(OpeningWindow.ofNullable(opensAt, closesAt)
                .map(window -> impact.ofOpeningHours(weekday, window, effectiveFrom, cursor, limit))
                .orElseGet(() -> impact.ofClosingWeekday(weekday, effectiveFrom, cursor, limit))));
    }

    @Override
    public ResponseEntity<ApiImpact> openingPeriodImpact(ApiOpeningPeriodImpactRequest request, UUID cursor,
                                                         Integer limit) {
        return ResponseEntity.ok(toResponse(impact.ofOpeningPeriod(request.getPeriodId(),
                OpeningPeriod.Kind.valueOf(request.getKind().getValue()), request.getStartsOn(),
                request.getEndsOn(), openOn(request.getDays()), cursor, limit)));
    }

    @Override
    public ResponseEntity<ApiImpact> courtClosureImpact(ApiCourtClosureImpactRequest request, UUID cursor,
                                                        Integer limit) {
        return ResponseEntity.ok(toResponse(impact.ofCourtClosure(request.getClosureId(), request.getCourtId(),
                request.getStartsOn(), request.getEndsOn(), cursor, limit)));
    }

    private static Map<DayOfWeek, OpeningWindow> openOn(List<ApiOpeningHours> days) {
        Map<DayOfWeek, OpeningWindow> open = new EnumMap<>(DayOfWeek.class);
        List<DayOfWeek> named = days.stream().map(day -> WireTypes.toDayOfWeek(day.getDayOfWeek())).distinct().toList();
        if (named.size() != DayOfWeek.values().length) {
            throw new OpeningWeekIncompleteException();
        }
        days.forEach(day -> OpeningWindow.ofNullable(day.getOpensAt(), day.getClosesAt())
                .ifPresent(window -> open.put(WireTypes.toDayOfWeek(day.getDayOfWeek()), window)));
        return open;
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
