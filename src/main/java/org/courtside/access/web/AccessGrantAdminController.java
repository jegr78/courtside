package org.courtside.access.web;

import lombok.RequiredArgsConstructor;
import org.courtside.access.internal.AccessGrantAdministration;
import org.courtside.access.internal.AccessGrantAdministration.GrantView;
import org.courtside.access.internal.AccessGrantAdministration.Overview;
import org.courtside.api.AdminAccessGrantsApi;
import org.courtside.api.ApiAccessControlGroup;
import org.courtside.api.ApiAccessControlGroups;
import org.courtside.api.ApiAccessControlProbe;
import org.courtside.api.ApiAccessControlProbeOutcome;
import org.courtside.api.ApiAccessGrantOverview;
import org.courtside.api.ApiAdminAccessGrant;
import org.courtside.api.ApiAdminAccessGrantCourt;
import org.courtside.api.ApiAdminAccessGrantStatus;
import org.courtside.shared.WireTypes;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequiredArgsConstructor
class AccessGrantAdminController implements AdminAccessGrantsApi {

    private final AccessGrantAdministration administration;

    @Override
    public ResponseEntity<ApiAccessGrantOverview> listAccessGrants() {
        Overview overview = administration.overview();
        ApiAccessControlProbe probe = overview.probe() == null ? null : new ApiAccessControlProbe(
                overview.probe().reachable(),
                ApiAccessControlProbeOutcome.valueOf(overview.probe().classification().name()),
                overview.probe().detail(),
                WireTypes.toOffsetDateTime(overview.probe().checkedAt()));
        return ResponseEntity.ok(new ApiAccessGrantOverview(overview.connector(), overview.connected(), probe,
                overview.grants().stream().map(AccessGrantAdminController::toResponse).toList(), overview.total()));
    }

    @Override
    public ResponseEntity<ApiAccessControlGroups> listAccessControlGroups() {
        AccessGrantAdministration.Groups groups = administration.groups();
        return ResponseEntity.ok(new ApiAccessControlGroups(false,
                groups.groups().stream().map(group -> new ApiAccessControlGroup(group.id(), group.name())).toList(),
                WireTypes.toOffsetDateTime(groups.readAt())));
    }

    @Override
    public ResponseEntity<Void> probeAccessControl() {
        administration.requestProbe();
        return ResponseEntity.accepted().build();
    }

    @Override
    public ResponseEntity<ApiAdminAccessGrant> retryAccessGrant(UUID id) {
        return ResponseEntity.ok(toResponse(administration.retry(id)));
    }

    private static ApiAdminAccessGrant toResponse(GrantView grant) {
        return new ApiAdminAccessGrant(grant.id(), grant.bookingId(),
                ApiAdminAccessGrantStatus.valueOf(grant.status().name()),
                WireTypes.toOffsetDateTime(grant.validFrom()), WireTypes.toOffsetDateTime(grant.validUntil()),
                WireTypes.toOffsetDateTime(grant.startsAt()), WireTypes.toOffsetDateTime(grant.endsAt()),
                grant.courts().stream().map(court -> new ApiAdminAccessGrantCourt(court.number(), court.name())).toList(),
                grant.accessPoints(), grant.attempts(), grant.lastFailure(),
                WireTypes.toOffsetDateTime(grant.nextAttemptAt()));
    }
}
