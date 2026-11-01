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
import org.courtside.shared.BookingAnnouncement.DynamicAccess;
import org.courtside.shared.IssuedAccessCodes;
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
 * The access points a booking's players need at the door, with static codes or the booking's own code, while
 * its card grants access and until its validity window ends.
 */
@Component
@RequiredArgsConstructor
public class AccessGrants {

    private final FacilityService facility;
    private final CardService cards;
    private final AccessPolicy policy;
    private final IssuedAccessCodes issuedCodes;
    private final Clock clock;

    public Set<UUID> dynamicallyServedCourts() {
        return facility.activeAccessPointsWithoutCodes().stream()
                .flatMap(accessPoint -> accessPoint.getCourtIds().stream()).collect(Collectors.toSet());
    }

    public Map<UUID, AccessDemand> demandsOf(Collection<Booking> bookings) {
        Map<UUID, AccessDemand> demands = new HashMap<>();
        servedBy(bookings, facility.activeAccessPointsWithoutCodes()).forEach((bookingId, served) ->
                demands.put(bookingId, new AccessDemand(bookingId, served.startsAt(), served.validFrom(),
                        served.validUntil(), served.accessPoints().stream().map(AccessPoint::getId)
                                .collect(Collectors.toSet()))));
        return demands;
    }

    public Duration accessLag() {
        return Duration.ofMinutes(policy.accessLag().minutes());
    }

    public Map<UUID, AnnouncedAccess> of(Collection<Booking> bookings) {
        Map<UUID, AnnouncedAccess> grants = new HashMap<>();
        windowsOf(bookings, facility.activeAccessPointsWithCodes()).forEach((bookingId, served) -> grants.put(
                bookingId, new AnnouncedAccess(served.validFrom(), served.validUntil(), served.accessPoints().stream()
                        .map(accessPoint -> new AccessCode(accessPoint.getName(), accessPoint.getStaticCode()))
                        .toList())));
        return grants;
    }

    public Optional<AnnouncedAccess> of(Booking booking) {
        return Optional.ofNullable(of(List.of(booking)).get(booking.getId()));
    }

    public Map<UUID, DynamicAccess> dynamicOf(Collection<Booking> bookings) {
        if (!issuedCodes.issuesCodes()) {
            return Map.of();
        }
        Map<UUID, DynamicAccess> dynamic = new HashMap<>();
        windowsOf(bookings, facility.activeAccessPointsWithoutCodes()).forEach((bookingId, served) -> dynamic.put(
                bookingId, new DynamicAccess(served.validFrom(), served.validUntil(),
                        served.accessPoints().stream().map(AccessPoint::getName).toList(),
                        served.accessPoints().stream().anyMatch(accessPoint -> accessPoint.getEmergencyCode() != null))));
        return dynamic;
    }

    public Optional<DynamicAccess> dynamicOf(Booking booking) {
        return Optional.ofNullable(dynamicOf(List.of(booking)).get(booking.getId()));
    }

    public Optional<ServedWindow> dynamicWindowOf(Booking booking) {
        if (!issuedCodes.issuesCodes()) {
            return Optional.empty();
        }
        return Optional.ofNullable(windowsOf(List.of(booking), facility.activeAccessPointsWithoutCodes())
                .get(booking.getId()));
    }

    private Map<UUID, ServedWindow> windowsOf(Collection<Booking> bookings, List<AccessPoint> candidates) {
        Instant now = clock.instant();
        Map<UUID, ServedWindow> windows = new HashMap<>();
        servedBy(bookings, candidates).forEach((bookingId, served) -> {
            if (now.isBefore(served.validUntil())) {
                windows.put(bookingId, new ServedWindow(served.validFrom(), served.validUntil(),
                        served.accessPoints()));
            }
        });
        return windows;
    }

    /** The window and serving access points of every confirmed booking whose card grants access, ended or not. */
    private Map<UUID, Served> servedBy(Collection<Booking> bookings, List<AccessPoint> candidates) {
        List<Booking> confirmed = bookings.stream()
                .filter(booking -> booking.getStatus() == BookingStatus.CONFIRMED).toList();
        Set<UUID> granting = confirmed.stream().map(Booking::getCardId).distinct()
                .filter(cardId -> cards.findCard(cardId).filter(BookingCard::isGrantsAccess).isPresent())
                .collect(Collectors.toSet());
        if (granting.isEmpty() || candidates.isEmpty()) {
            return Map.of();
        }
        Duration lead = Duration.ofMinutes(policy.accessLead().minutes());
        Duration lag = Duration.ofMinutes(policy.accessLag().minutes());
        Map<UUID, Served> served = new HashMap<>();
        for (Booking booking : confirmed) {
            List<CourtAllocation> allocations = booking.getAllocations();
            if (!granting.contains(booking.getCardId()) || allocations.isEmpty()) {
                continue;
            }
            Set<UUID> courts = allocations.stream().map(CourtAllocation::getCourtId).collect(Collectors.toSet());
            List<AccessPoint> serving = candidates.stream()
                    .filter(accessPoint -> courts.stream().anyMatch(accessPoint::serves)).toList();
            if (serving.isEmpty()) {
                continue;
            }
            Instant startsAt = allocations.stream().map(CourtAllocation::getStartsAt)
                    .min(Comparator.naturalOrder()).orElseThrow();
            Instant endsAt = allocations.stream().map(CourtAllocation::getEndsAt)
                    .max(Comparator.naturalOrder()).orElseThrow();
            served.put(booking.getId(), new Served(startsAt, startsAt.minus(lead), endsAt.plus(lag), serving));
        }
        return served;
    }

    public record ServedWindow(Instant validFrom, Instant validUntil, List<AccessPoint> accessPoints) {
    }

    private record Served(Instant startsAt, Instant validFrom, Instant validUntil, List<AccessPoint> accessPoints) {
    }
}
