package org.courtside.booking.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.booking.Booking;
import org.courtside.booking.BookingStatus;
import org.courtside.booking.CourtAllocation;
import org.courtside.card.BookingCard;
import org.courtside.card.CardService;
import org.courtside.config.AccessPolicy;
import org.courtside.facility.AccessPoint;
import org.courtside.facility.FacilityService;
import org.courtside.shared.BookingAnnouncement.AccessCode;
import org.courtside.shared.BookingAnnouncement.AnnouncedAccess;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Instant;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * The static codes a booking's players need at the door: those of every active access point serving one
 * of its courts, while its card grants access and until its validity window ends.
 */
@Component
@RequiredArgsConstructor
public class AccessGrants {

    private final FacilityService facility;
    private final CardService cards;
    private final AccessPolicy policy;
    private final Clock clock;

    public Map<UUID, AnnouncedAccess> of(Collection<Booking> bookings) {
        if (bookings.isEmpty()) {
            return Map.of();
        }
        List<AccessPoint> accessPoints = facility.activeAccessPointsWithCodes();
        if (accessPoints.isEmpty()) {
            return Map.of();
        }
        Set<UUID> granting = cards.allCards().stream().filter(BookingCard::isGrantsAccess)
                .map(BookingCard::getId).collect(Collectors.toSet());
        Window window = new Window(policy.accessLead().minutes(),
                policy.accessLag().minutes(), clock.instant());
        Map<UUID, AnnouncedAccess> grants = new HashMap<>();
        for (Booking booking : bookings) {
            if (booking.getStatus() == BookingStatus.CONFIRMED && granting.contains(booking.getCardId())) {
                window.grantFor(booking, accessPoints).ifPresent(grant -> grants.put(booking.getId(), grant));
            }
        }
        return grants;
    }

    public Optional<AnnouncedAccess> of(Booking booking) {
        return Optional.ofNullable(of(List.of(booking)).get(booking.getId()));
    }

    private record Window(long leadMinutes, long lagMinutes, Instant now) {

        Optional<AnnouncedAccess> grantFor(Booking booking, List<AccessPoint> accessPoints) {
            List<CourtAllocation> allocations = booking.getAllocations();
            if (allocations.isEmpty()) {
                return Optional.empty();
            }
            Instant validFrom = allocations.stream().map(CourtAllocation::getStartsAt)
                    .min(Comparator.naturalOrder()).orElseThrow().minusSeconds(leadMinutes * 60);
            Instant validUntil = allocations.stream().map(CourtAllocation::getEndsAt)
                    .max(Comparator.naturalOrder()).orElseThrow().plusSeconds(lagMinutes * 60);
            if (!now.isBefore(validUntil)) {
                return Optional.empty();
            }
            Set<UUID> courts = allocations.stream().map(CourtAllocation::getCourtId).collect(Collectors.toSet());
            List<AccessCode> codes = accessPoints.stream()
                    .filter(accessPoint -> courts.stream().anyMatch(accessPoint::serves))
                    .map(accessPoint -> new AccessCode(accessPoint.getName(), accessPoint.getStaticCode()))
                    .toList();
            return codes.isEmpty() ? Optional.empty() : Optional.of(new AnnouncedAccess(validFrom, validUntil, codes));
        }
    }
}
