package org.courtside.member.web;

import lombok.RequiredArgsConstructor;
import org.courtside.api.AdminRosterApi;
import org.courtside.api.ApiAccountRequest;
import org.courtside.api.ApiActiveRequest;
import org.courtside.api.ApiMembershipRequest;
import org.courtside.api.ApiPersonRequest;
import org.courtside.api.ApiRole;
import org.courtside.api.ApiRolesRequest;
import org.courtside.api.ApiAccountLocaleRequest;
import org.courtside.api.ApiRosterEntry;
import org.courtside.api.ApiRosterPage;
import org.courtside.api.ApiUsernameRequest;
import org.courtside.identity.Role;
import org.courtside.member.MembershipPeriod;
import org.courtside.member.RosterService;
import org.courtside.shared.CursorPage;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.time.LocalDate;
import java.util.Collection;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;

@RestController
@RequiredArgsConstructor
class RosterAdminController implements AdminRosterApi {

    private final RosterService roster;

    @Override
    public ResponseEntity<ApiRosterPage> listRoster(String query, UUID membershipTypeId, UUID cursor, Integer limit) {
        CursorPage.Result<RosterService.RosterEntry> page = roster.list(query, membershipTypeId, cursor, limit);
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
    public ResponseEntity<ApiRosterEntry> readPerson(UUID personId) {
        return ResponseEntity.ok(toResponse(roster.person(personId)));
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
                        roles(request.getRoles()))));
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
    public ResponseEntity<ApiRosterEntry> changeAccountLocale(UUID personId,
                                                              ApiAccountLocaleRequest request) {
        return ResponseEntity.ok(toResponse(roster.changeLocale(personId, request.getLocale())));
    }

    @Override
    public ResponseEntity<ApiRosterEntry> requestAccountCredentials(UUID personId) {
        return ResponseEntity.ok(toResponse(roster.requestCredentials(personId)));
    }

    @Override
    public ResponseEntity<ApiRosterEntry> setAccountActive(UUID personId, ApiActiveRequest request) {
        return ResponseEntity.ok(toResponse(
                roster.setAccountEnabled(personId, request.getActive())));
    }

    @Override
    public ResponseEntity<ApiRosterEntry> assignMembership(UUID personId,
                                                           ApiMembershipRequest request) {
        return ResponseEntity.ok(toResponse(roster.writeMembership(personId,
                request.getMembershipTypeId(),
                new MembershipPeriod(request.getStartedOn(), request.getEndedOn()))));
    }

    @Override
    public ResponseEntity<Void> removeMembership(UUID personId) {
        roster.endMembership(personId);
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
                address(entry.email()), entry.enabled(), roleNames(entry.roles()))
                .addressSharedBy(entry.addressSharedBy())
                .accountId(entry.accountId())
                .username(entry.username())
                .locale(entry.locale())
                .credentialState(credentialState(entry))
                .membershipTypeId(membershipTypeId(entry))
                .membershipStartedOn(membershipDate(entry, RosterService.Membership::startedOn))
                .membershipEndedOn(membershipDate(entry, RosterService.Membership::endedOn));
    }

    private static ApiRosterEntry.CredentialStateEnum credentialState(RosterService.RosterEntry entry) {
        return entry.credentialState() == null
                ? null
                : ApiRosterEntry.CredentialStateEnum.fromValue(entry.credentialState().name());
    }

    private static String address(String email) {
        return email.isEmpty() ? null : email;
    }

    private static UUID membershipTypeId(RosterService.RosterEntry entry) {
        return entry.membership() == null ? null : entry.membership().typeId();
    }

    private static LocalDate membershipDate(RosterService.RosterEntry entry,
                                            Function<RosterService.Membership, LocalDate> date) {
        return entry.membership() == null ? null : date.apply(entry.membership());
    }

    private static List<ApiRole> roleNames(Set<Role> roles) {
        return roles.stream()
                .map(Role::name)
                .sorted()
                .map(ApiRole::fromValue)
                .toList();
    }
}
