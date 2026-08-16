package org.courtside.member.web;

import lombok.RequiredArgsConstructor;
import org.courtside.api.AdminRosterApi;
import org.courtside.api.ApiPersonRequest;
import org.courtside.api.ApiRole;
import org.courtside.api.ApiRosterEntry;
import org.courtside.api.ApiRosterPage;
import org.courtside.identity.Role;
import org.courtside.member.RosterService;
import org.courtside.shared.CursorPage;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.util.List;
import java.util.Set;
import java.util.UUID;

@RestController
@RequiredArgsConstructor
class RosterAdminController implements AdminRosterApi {

    private final RosterService roster;

    @Override
    public ResponseEntity<ApiRosterPage> listRoster(String query, UUID cursor, Integer limit) {
        CursorPage.Result<RosterService.RosterEntry> page = roster.list(query, cursor, limit);
        return ResponseEntity.ok(new ApiRosterPage(page.items().stream()
                .map(RosterAdminController::toResponse)
                .toList())
                .nextCursor(page.nextCursor()));
    }

    @Override
    public ResponseEntity<ApiRosterEntry> createPerson(ApiPersonRequest request) {
        RosterService.RosterEntry entry = roster.createPerson(
                request.getFirstName(), request.getLastName(), request.getEmail());
        return ResponseEntity
                .created(URI.create("/api/admin/roster/" + entry.personId()))
                .body(toResponse(entry));
    }

    @Override
    public ResponseEntity<ApiRosterEntry> changePerson(UUID personId, ApiPersonRequest request) {
        return ResponseEntity.ok(toResponse(roster.changePerson(
                personId, request.getFirstName(), request.getLastName(), request.getEmail())));
    }

    private static ApiRosterEntry toResponse(RosterService.RosterEntry entry) {
        return new ApiRosterEntry(entry.personId(), entry.firstName(), entry.lastName(),
                entry.email(), entry.enabled(), roleNames(entry.roles()))
                .accountId(entry.accountId())
                .username(entry.username())
                .membershipTypeId(entry.membershipTypeId());
    }

    private static List<ApiRole> roleNames(Set<Role> roles) {
        return roles.stream()
                .map(role -> ApiRole.fromValue(role.name()))
                .toList();
    }
}
