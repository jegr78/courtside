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
import org.courtside.shared.AccessDemand;
import org.courtside.shared.BookingAnnouncement.AccessCode;
import org.courtside.shared.BookingAnnouncement.AnnouncedAccess;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;
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

    public Set<UUID> dynamicallyServedCourts() {
        return facility.activeAccessPointsWithoutCodes().stream()
                .flatMap(accessPoint -> accessPoint.getCourtIds().stream()).collect(Collectors.toSet());
    }

    public Map<UUID, AccessDemand> demandsOf(Collection<Booking> bookings) {
        List<Booking> confirmed = bookings.stream()
                .filter(booking -> booking.getStatus() == BookingStatus.CONFIRMED).toList();
        Set<UUID> granting = confirmed.stream().map(Booking::getCardId).distinct()
                .filter(cardId -> cards.findCard(cardId).filter(BookingCard::isGrantsAccess).isPresent())
                .collect(Collectors.toSet());
        if (granting.isEmpty()) {
            return Map.of();
        }
        List<AccessPoint> accessPoints = facility.activeAccessPointsWithoutCodes();
        if (accessPoints.isEmpty()) {
            return Map.of();
        }
        Duration lead = Duration.ofMinutes(policy.accessLead().minutes());
        Duration lag = Duration.ofMinutes(policy.accessLag().minutes());
        Map<UUID, AccessDemand> demands = new HashMap<>();
        for (Booking booking : confirmed) {
            List<CourtAllocation> allocations = booking.getAllocations();
            if (!granting.contains(booking.getCardId()) || allocations.isEmpty()) {
                continue;
            }
            Set<UUID> courts = allocations.stream().map(CourtAllocation::getCourtId).collect(Collectors.toSet());
            Set<UUID> served = accessPoints.stream()
                    .filter(accessPoint -> courts.stream().anyMatch(accessPoint::serves))
                    .map(AccessPoint::getId).collect(Collectors.toSet());
            if (served.isEmpty()) {
                continue;
            }
            Instant startsAt = allocations.stream().map(CourtAllocation::getStartsAt)
                    .min(Comparator.naturalOrder()).orElseThrow();
            Instant endsAt = allocations.stream().map(CourtAllocation::getEndsAt)
                    .max(Comparator.naturalOrder()).orElseThrow();
            demands.put(booking.getId(), new AccessDemand(booking.getId(), startsAt, startsAt.minus(lead),
                    endsAt.plus(lag), served));
        }
        return demands;
    }

    public Duration accessLag() {
        return Duration.ofMinutes(policy.accessLag().minutes());
    }

    public Map<UUID, AnnouncedAccess> of(Collection<Booking> bookings) {
        List<Booking> confirmed = bookings.stream()
                .filter(booking -> booking.getStatus() == BookingStatus.CONFIRMED).toList();
        Set<UUID> granting = confirmed.stream().map(Booking::getCardId).distinct()
                .filter(cardId -> cards.findCard(cardId).filter(BookingCard::isGrantsAccess).isPresent())
                .collect(Collectors.toSet());
        if (granting.isEmpty()) {
            return Map.of();
        }
        List<AccessPoint> accessPoints = facility.activeAccessPointsWithCodes();
        if (accessPoints.isEmpty()) {
            return Map.of();
        }
        Window window = new Window(policy.accessLead().minutes(),
                policy.accessLag().minutes(), clock.instant());
        Map<UUID, AnnouncedAccess> grants = new HashMap<>();
        for (Booking booking : confirmed) {
            if (granting.contains(booking.getCardId())) {
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
