package org.courtside.booking.web;

import lombok.RequiredArgsConstructor;
import org.courtside.api.ApiBookingStatus;
import org.courtside.api.ApiAccessCode;
import org.courtside.api.ApiAccessGrant;
import org.courtside.api.ApiCheckIn;
import org.courtside.api.ApiParticipation;
import org.courtside.api.ApiParticipationPage;
import org.courtside.api.ApiPartnerSearchState;
import org.courtside.api.ApiPersonalBooking;
import org.courtside.api.ApiPersonalBookingPage;
import org.courtside.api.ApiPersonalBookingView;
import org.courtside.api.ApiPublicCourt;
import org.courtside.booking.Booking;
import org.courtside.booking.BookingStatus;
import org.courtside.booking.CourtAllocation;
import org.courtside.booking.ParticipationPage;
import org.courtside.booking.PersonalBookingPage;
import org.courtside.booking.attendance.AttendanceService;
import org.courtside.booking.internal.AccessGrants;
import org.courtside.booking.partner.PartnerSearchService;
import org.courtside.booking.partner.PartnerSearchState;
import org.courtside.card.BookingCard;
import org.courtside.card.CardService;
import org.courtside.config.ClubIdentity;
import org.courtside.config.ClubTimeZone;
import org.courtside.facility.FacilityService;
import org.courtside.shared.BookingAnnouncement.AnnouncedAccess;
import org.courtside.shared.BookingAnnouncement.DynamicAccess;
import org.courtside.shared.IssuedAccessCodes;
import org.courtside.shared.WireTypes;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.util.ArrayList;
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
    private final AccessGrants accessGrants;
    private final IssuedAccessCodes issuedCodes;

    // A booking's own code goes only to its participants, so a page of somebody else's bookings carries none.
    ApiPersonalBookingPage render(PersonalBookingPage page, ApiPersonalBookingView view, boolean ownBookings) {
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
        Map<UUID, AnnouncedAccess> access = accessGrants.of(page.bookings());
        Map<UUID, DynamicAccess> dynamic = ownBookings ? accessGrants.dynamicOf(page.bookings()) : Map.of();
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
                            .released(released.contains(booking.getId()) ? Boolean.TRUE : null)
                            .access(toAccess(booking.getId(), access.get(booking.getId()),
                                    dynamic.get(booking.getId())));
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

    ApiParticipationPage renderParticipations(ParticipationPage page) {
        Map<UUID, BookingCard> cardsById = cards.allCards().stream()
                .collect(Collectors.toMap(BookingCard::getId, card -> card));
        Map<UUID, AnnouncedAccess> access = accessGrants.of(page.bookings());
        Map<UUID, DynamicAccess> dynamic = accessGrants.dynamicOf(page.bookings());
        List<ApiParticipation> items = page.bookings().stream()
                .map(booking -> {
                    List<CourtAllocation> allocations = booking.getAllocations();
                    CourtAllocation first = allocations.getFirst();
                    BookingCard card = cardsById.get(booking.getCardId());
                    return new ApiParticipation(
                            booking.getId(),
                            allocations.stream().map(CourtAllocation::getCourtId).toList(),
                            WireTypes.toOffsetDateTime(first.getStartsAt()),
                            WireTypes.toOffsetDateTime(first.getEndsAt()),
                            card == null ? "?" : card.getLabel(),
                            card == null ? "#999999" : card.getColor(),
                            ApiBookingStatus.fromValue(booking.getStatus().name()))
                            .access(toAccess(booking.getId(), access.get(booking.getId()),
                                    dynamic.get(booking.getId())));
                })
                .toList();
        return new ApiParticipationPage(items).nextCursor(page.nextCursor());
    }

    private ApiAccessGrant toAccess(UUID bookingId, AnnouncedAccess fixed, DynamicAccess dynamic) {
        if (fixed == null && dynamic == null) {
            return null;
        }
        List<ApiAccessCode> codes = new ArrayList<>(fixed == null ? List.of() : fixed.codes().stream()
                .map(code -> new ApiAccessCode(code.accessPointName(), code.code())).toList());
        String issued = dynamic == null ? null
                : issuedCodes.codeOf(bookingId).orElse(null);
        if (issued != null) {
            dynamic.accessPointNames().forEach(name -> codes.add(new ApiAccessCode(name, issued)));
        }
        return new ApiAccessGrant(
                WireTypes.toOffsetDateTime(fixed == null ? dynamic.validFrom() : fixed.validFrom()),
                WireTypes.toOffsetDateTime(fixed == null ? dynamic.validUntil() : fixed.validUntil()), codes)
                .codePending(dynamic != null && issued == null ? Boolean.TRUE : null)
                .emergencyCodeKept(dynamic != null && dynamic.emergencyCodeKept() ? Boolean.TRUE : null);
    }

    private static ApiCheckIn toCheckIn(AttendanceService.CheckIn checkIn) {
        return checkIn == null ? null : new ApiCheckIn(WireTypes.toOffsetDateTime(checkIn.opensAt()),
                WireTypes.toOffsetDateTime(checkIn.closesAt()), checkIn.checkedIn());
    }
}
