package org.courtside.booking.web;

import lombok.RequiredArgsConstructor;
import org.courtside.api.ApiBookingStatus;
import org.courtside.api.ApiCheckIn;
import org.courtside.api.ApiPartnerSearchState;
import org.courtside.api.ApiPersonalBooking;
import org.courtside.api.ApiPersonalBookingPage;
import org.courtside.api.ApiPersonalBookingView;
import org.courtside.api.ApiPublicCourt;
import org.courtside.booking.Booking;
import org.courtside.booking.BookingStatus;
import org.courtside.booking.CourtAllocation;
import org.courtside.booking.PersonalBookingPage;
import org.courtside.booking.attendance.AttendanceService;
import org.courtside.booking.partner.PartnerSearchService;
import org.courtside.booking.partner.PartnerSearchState;
import org.courtside.card.BookingCard;
import org.courtside.card.CardService;
import org.courtside.config.ClubIdentity;
import org.courtside.config.ClubTimeZone;
import org.courtside.facility.FacilityService;
import org.courtside.shared.WireTypes;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

@Component
@RequiredArgsConstructor
class PersonalBookingPages {

    private final CardService cards;
    private final PartnerSearchService partnerSearch;
    private final AttendanceService attendance;
    private final FacilityService facility;
    private final ClubTimeZone timeZone;
    private final ClubIdentity club;
    private final Clock clock;

    ApiPersonalBookingPage render(PersonalBookingPage page, ApiPersonalBookingView view) {
        Map<UUID, BookingCard> cardsById = cards.allCards().stream()
                .collect(Collectors.toMap(BookingCard::getId, card -> card));
        Map<UUID, PartnerSearchState> searches = partnerSearch.searchStatesOf(
                page.bookings().stream().map(Booking::getId).toList());
        Map<UUID, AttendanceService.CheckIn> checkIns = view == ApiPersonalBookingView.UPCOMING
                ? attendance.checkInsOf(page.bookings().stream()
                        .filter(booking -> booking.getStatus() == BookingStatus.CONFIRMED)
                        .map(booking -> new AttendanceService.TimedBooking(booking.getId(),
                                booking.getAllocations().getFirst().getStartsAt(),
                                booking.getAllocations().getFirst().getEndsAt()))
                        .toList())
                : Map.of();
        Set<UUID> released = attendance.releasedAmong(page.bookings().stream()
                .filter(booking -> booking.getStatus() == BookingStatus.CANCELLED)
                .map(Booking::getId)
                .toList());
        List<ApiPersonalBooking> items = page.bookings().stream()
                .map(booking -> {
                    List<CourtAllocation> allocations = booking.getAllocations();
                    CourtAllocation first = allocations.getFirst();
                    BookingCard card = cardsById.get(booking.getCardId());
                    return new ApiPersonalBooking(
                            booking.getId(),
                            allocations.stream().map(CourtAllocation::getCourtId).toList(),
                            WireTypes.toOffsetDateTime(first.getStartsAt()),
                            WireTypes.toOffsetDateTime(first.getEndsAt()),
                            card == null ? "?" : card.getLabel(),
                            card == null ? "#999999" : card.getColor(),
                            ApiBookingStatus.fromValue(booking.getStatus().name()))
                            .seriesId(booking.getSeriesId())
                            .note(booking.getNote())
                            .partnerSearch(searches.containsKey(booking.getId())
                                    ? ApiPartnerSearchState.fromValue(searches.get(booking.getId()).name()) : null)
                            .checkIn(toCheckIn(checkIns.get(booking.getId())))
                            .released(released.contains(booking.getId()) ? Boolean.TRUE : null);
                })
                .toList();
        List<ApiPublicCourt> courtLabels = facility.allCourts().stream()
                .map(court -> new ApiPublicCourt(court.getId(), court.getNumber(), court.getName()))
                .toList();
        return new ApiPersonalBookingPage(items)
                .nextCursor(page.nextCursor())
                .refreshedAt(WireTypes.toOffsetDateTime(clock.instant()))
                .timeZone(timeZone.id())
                .courts(courtLabels)
                .clubName(club.clubName());
    }

    private static ApiCheckIn toCheckIn(AttendanceService.CheckIn checkIn) {
        return checkIn == null ? null : new ApiCheckIn(WireTypes.toOffsetDateTime(checkIn.opensAt()),
                WireTypes.toOffsetDateTime(checkIn.closesAt()), checkIn.checkedIn());
    }
}
