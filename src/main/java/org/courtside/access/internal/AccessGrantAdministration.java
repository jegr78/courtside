package org.courtside.access.internal;

import org.courtside.access.AccessControlConnector;
import org.courtside.access.AccessGrantEvent;
import org.courtside.access.CheckOutcome;
import org.courtside.access.GrantStatus;
import org.courtside.access.RemoteGroup;
import org.courtside.facility.AccessPoint;
import org.courtside.facility.FacilityService;
import org.courtside.shared.BookingAnnouncement;
import org.courtside.shared.BookingAnnouncer;
import org.jspecify.annotations.Nullable;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/** What a board sees of the access grants and what it may ask for: a retry and a connection check. */
@Service
public class AccessGrantAdministration {

    private final AccessGrantRepository grants;
    private final ProbeReadings readings;
    private final ConnectionCheckReadings checks;
    private final ObjectProvider<AccessWorker> worker;
    private final ObjectProvider<AccessControlConnector> connectors;
    private final BookingAnnouncer bookings;
    private final FacilityService facility;
    private final PassClock clock;
    private final ApplicationEventPublisher events;
    private final String connector;

    AccessGrantAdministration(AccessGrantRepository grants, ProbeReadings readings, ConnectionCheckReadings checks,
                              ObjectProvider<AccessWorker> worker,
                              ObjectProvider<AccessControlConnector> connectors, BookingAnnouncer bookings,
                              FacilityService facility, PassClock clock, ApplicationEventPublisher events,
                              @Value("${courtside.access-control.connector}") String connector) {
        this.grants = grants;
        this.readings = readings;
        this.checks = checks;
        this.worker = worker;
        this.connectors = connectors;
        this.bookings = bookings;
        this.facility = facility;
        this.clock = clock;
        this.events = events;
        this.connector = connector == null ? "" : connector.strip().toLowerCase(Locale.ROOT);
    }

    public Overview overview() {
        List<AccessGrant> shown = grants.findShown();
        return new Overview(connector, worker.getIfAvailable() != null,
                readings.latest().map(reading -> new Probe(reading.reachable(), reading.classification(), reading.detail(),
                        reading.checkedAt())).orElse(null),
                views(shown), grants.countNotDone());
    }

    /** The groups the last answered probe read, without calling the system; empty and untimed without any. */
    public Groups groups() {
        AccessControlConnector connector = connectors.getIfAvailable();
        boolean offered = connector != null && connector.listsGroups();
        List<RemoteGroup> listed = offered ? connector.groups() : List.of();
        return listed.isEmpty() ? new Groups(offered, List.of(), null)
                : new Groups(true, listed, readings.answeredAt().orElse(null));
    }

    @Transactional
    public GrantView retry(UUID grantId) {
        if (worker.getIfAvailable() == null) {
            throw new AccessControlNotConnectedException();
        }
        AccessGrant grant = grants.findLockedById(grantId).orElseThrow(AccessGrantNotFoundException::new);
        if (grant.status() != GrantStatus.FAILING) {
            throw new AccessGrantNotFailingException(grant.status());
        }
        grant.requestRetry(clock.now());
        events.publishEvent(new AccessGrantEvent.RetryRequested(grant.getId(), grant.getBookingId()));
        return views(List.of(grant)).getFirst();
    }

    /** Asks the next pass for a connection check, which also probes and so reloads the groups. */
    @Transactional
    public void requestConnectionCheck() {
        AccessWorker running = worker.getIfAvailable();
        if (running == null) {
            throw new AccessControlNotConnectedException();
        }
        events.publishEvent(new AccessControlEvent.CheckRequested());
        checks.request();
        readings.request();
        running.signal();
    }

    /** The latest connection check, without calling the system; empty and untimed before the first one. */
    public ConnectionCheckView connectionCheck() {
        return checks.latest().map(report -> new ConnectionCheckView(report.checkedAt(), report.checks().stream()
                        .map(entry -> new CheckView(entry.check(), entry.result().outcome(), entry.result().code(),
                                entry.result().parameters())).toList()))
                .orElse(new ConnectionCheckView(null, List.of()));
    }

    private List<GrantView> views(List<AccessGrant> shown) {
        Map<UUID, String> names = facility.allAccessPoints().stream()
                .collect(Collectors.toMap(AccessPoint::getId, AccessPoint::getName));
        Map<UUID, BookingAnnouncement> described = bookings.describeAll(
                shown.stream().map(AccessGrant::getBookingId).toList());
        return shown.stream().map(grant -> view(grant, described.get(grant.getBookingId()), names)).toList();
    }

    private static GrantView view(AccessGrant grant, @Nullable BookingAnnouncement booking, Map<UUID, String> names) {
        Set<UUID> points = grant.isWanted() ? grant.getWantPoints() : grant.getRemotePoints();
        return new GrantView(grant.getId(), grant.getBookingId(), grant.status(), grant.getWantFrom(),
                grant.getWantUntil(), booking == null ? null : booking.startsAt(),
                booking == null ? null : booking.endsAt(),
                booking == null ? List.of() : booking.courts(),
                points.stream().map(names::get).filter(Objects::nonNull).sorted(Comparator.naturalOrder()).toList(),
                grant.getAttempts(), grant.getLastFailure(), grant.getNextAttemptAt());
    }

    public record Overview(String connector, boolean connected, @Nullable Probe probe, List<GrantView> grants,
                           long total) {
    }

    public record Groups(boolean offered, List<RemoteGroup> groups, @Nullable Instant readAt) {
    }

    public record ConnectionCheckView(@Nullable Instant checkedAt, List<CheckView> checks) {
    }

    public record CheckView(String check, CheckOutcome outcome, String code, Map<String, String> parameters) {
    }

    public record Probe(boolean reachable, ProbeClassification classification, String detail, Instant checkedAt) {
    }

    public record GrantView(UUID id, UUID bookingId, GrantStatus status, @Nullable Instant validFrom,
                            @Nullable Instant validUntil, @Nullable Instant startsAt, @Nullable Instant endsAt,
                            List<BookingAnnouncement.AnnouncedCourt> courts, List<String> accessPoints, int attempts,
                            @Nullable String lastFailure, @Nullable Instant nextAttemptAt) {
    }
}
