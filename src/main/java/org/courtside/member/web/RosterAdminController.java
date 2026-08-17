package org.courtside.member.web;

import lombok.RequiredArgsConstructor;
import org.courtside.api.AdminRosterApi;
import org.courtside.api.ApiAccountRequest;
import org.courtside.api.ApiActiveRequest;
import org.courtside.api.ApiMembershipRequest;
import org.courtside.api.ApiPasswordResetRequest;
import org.courtside.api.ApiPersonRequest;
import org.courtside.api.ApiRole;
import org.courtside.api.ApiRolesRequest;
import org.courtside.api.ApiRosterEntry;
import org.courtside.api.ApiRosterPage;
import org.courtside.api.ApiUsernameRequest;
import org.courtside.identity.Role;
import org.courtside.member.RosterService;
import org.courtside.shared.CursorPage;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.util.Collection;
import java.util.Comparator;
import java.util.EnumSet;
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

    @Override
    public ResponseEntity<ApiRosterEntry> createAccount(UUID personId, ApiAccountRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(toResponse(roster.createAccount(personId, request.getUsername(),
                        request.getOneTimePassword(), roles(request.getRoles()))));
    }

    @Override
    public ResponseEntity<ApiRosterEntry> changeAccountRoles(UUID personId, ApiRolesRequest request) {
        return ResponseEntity.ok(toResponse(
                roster.changeRoles(personId, roles(request.getRoles()))));
    }

    @Override
    public ResponseEntity<ApiRosterEntry> changeAccountUsername(UUID personId,
                                                                ApiUsernameRequest request) {
        return ResponseEntity.ok(toResponse(
                roster.changeUsername(personId, request.getUsername())));
    }

    @Override
    public ResponseEntity<ApiRosterEntry> resetAccountPassword(UUID personId,
                                                               ApiPasswordResetRequest request) {
        return ResponseEntity.ok(toResponse(
                roster.resetPassword(personId, request.getOneTimePassword())));
    }

    @Override
    public ResponseEntity<ApiRosterEntry> setAccountActive(UUID personId, ApiActiveRequest request) {
        return ResponseEntity.ok(toResponse(
                roster.setAccountEnabled(personId, request.getActive())));
    }

    @Override
    public ResponseEntity<ApiRosterEntry> assignMembership(UUID personId,
                                                           ApiMembershipRequest request) {
        return ResponseEntity.ok(toResponse(
                roster.assignMembership(personId, request.getMembershipTypeId())));
    }

    @Override
    public ResponseEntity<Void> removeMembership(UUID personId) {
        roster.removeMembership(personId);
        return ResponseEntity.noContent().build();
    }

    private static Set<Role> roles(Collection<ApiRole> requested) {
        Set<Role> result = EnumSet.noneOf(Role.class);
        if (requested == null) {
            return result;
        }
        for (ApiRole role : requested) {
            result.add(Role.named(role.getValue()).orElseThrow(() -> new IllegalStateException(
                    "Unvalidated role name reached the roster boundary: " + role.getValue())));
        }
        return result;
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
                .sorted(Comparator.comparingInt(Enum::ordinal))
                .map(role -> ApiRole.fromValue(role.name()))
                .toList();
    }
}
