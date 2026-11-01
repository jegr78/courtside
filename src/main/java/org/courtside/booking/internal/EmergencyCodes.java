package org.courtside.booking.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.booking.Booking;
import org.courtside.booking.BookingParticipant;
import org.courtside.booking.BookingRepository;
import org.courtside.booking.BookingStatus;
import org.courtside.booking.CourtAllocation;
import org.courtside.facility.AccessPoint;
import org.courtside.shared.BookingAnnouncement.AccessCode;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class EmergencyCodes {

    private final BookingRepository bookings;
    private final AccessGrants accessGrants;
    private final ApplicationEventPublisher events;
    private final Clock clock;

    /** The emergency codes of the booking's dynamic access points, for its booker and players during its window. */
    @Transactional
    public List<AccessCode> request(UUID bookingId, UUID accountId, UUID personId) {
        if (bookingId == null || accountId == null) {
            throw new IllegalStateException("An emergency code is asked for a booking by an account");
        }
        Booking booking = bookings.findWithParticipantsById(bookingId)
                .orElseThrow(() -> new BookingNotFoundException("No booking with id " + bookingId));
        if (!takesPart(booking, accountId, personId)) {
            throw EmergencyCodeRefusedException.notParticipant();
        }
        if (booking.getStatus() != BookingStatus.CONFIRMED) {
            throw EmergencyCodeRefusedException.cancelled();
        }
        Instant now = clock.instant();
        if (booking.getAllocations().stream().map(CourtAllocation::getEndsAt)
                .noneMatch(endsAt -> now.isBefore(endsAt.plus(accessGrants.accessLag())))) {
            throw EmergencyCodeRefusedException.outsideWindow();
        }
        AccessGrants.ServedWindow window = accessGrants.dynamicWindowOf(booking)
                .orElseThrow(EmergencyCodeRefusedException::noneKept);
        if (now.isBefore(window.validFrom())) {
            throw EmergencyCodeRefusedException.outsideWindow();
        }
        List<AccessPoint> keeping = window.accessPoints().stream()
                .filter(accessPoint -> accessPoint.getEmergencyCode() != null).toList();
        if (keeping.isEmpty()) {
            throw EmergencyCodeRefusedException.noneKept();
        }
        events.publishEvent(new EmergencyCodeRequested(bookingId, keeping.stream().map(AccessPoint::getId).toList()));
        return keeping.stream().map(accessPoint -> new AccessCode(accessPoint.getName(), accessPoint.getEmergencyCode()))
                .toList();
    }

    private static boolean takesPart(Booking booking, UUID accountId, UUID personId) {
        return accountId.equals(booking.getBookedBy()) || personId != null && booking.getParticipants().stream()
                .map(BookingParticipant::getPersonId).filter(Objects::nonNull).anyMatch(personId::equals);
    }
}
