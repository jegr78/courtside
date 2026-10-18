package org.courtside.member.testfixture;

import lombok.RequiredArgsConstructor;
import org.courtside.member.GuardianGrant;
import org.courtside.member.GuardianRelationshipState;
import org.courtside.member.GuardianshipService;
import org.courtside.member.MemberService;
import org.courtside.member.MembershipPeriod;
import org.courtside.member.MembershipPeriodService;
import org.courtside.member.RosterChangeSet;
import org.courtside.member.RosterService;
import org.courtside.member.RosterSyncService;

import org.courtside.identity.Role;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

@RequiredArgsConstructor
public class MemberTestFixture {

    private static final LocalDate DEFAULT_STARTED_ON = LocalDate.of(2026, 1, 1);

    private final MemberService memberships;
    private final RosterService roster;
    private final RosterSyncService sync;
    private final MembershipPeriodService periods;
    private final GuardianshipService guardianships;

    public UUID addPerson(String firstName, String lastName, String email) {
        return roster.createPerson(firstName, lastName, email).personId();
    }

    public void changePerson(UUID personId, String firstName, String lastName, String email) {
        roster.changePerson(personId, firstName, lastName, email);
    }

    public void synchroniseCorrectedLastName(UUID personId, String lastName) {
        sync.apply(new RosterChangeSet(List.of(),
                List.of(new RosterChangeSet.PersonCorrection(personId, "4711", null, lastName, null, null, false)),
                List.of()));
    }

    public void synchroniseDeparture(UUID personId) {
        sync.apply(new RosterChangeSet(List.of(), List.of(), List.of(personId)));
    }

    public void giveAccount(UUID personId, String username, Set<Role> roles) {
        roster.createAccount(personId, username, roles);
    }

    public void changeAccountRoles(UUID personId, Set<Role> roles) {
        roster.changeRoles(personId, roles);
    }

    public void correctAccountUsername(UUID personId, String username) {
        roster.changeUsername(personId, username);
    }

    public void requestAccountCredentials(UUID personId) {
        roster.requestCredentials(personId);
    }

    public void setAccountEnabled(UUID personId, boolean enabled) {
        roster.setAccountEnabled(personId, enabled);
    }

    public UUID createMembershipType(String name) {
        return memberships.createMembershipType(name, null, false).getId();
    }

    public UUID membershipTypeGrantingAnAccount(String name) {
        return memberships.createMembershipType(name, null, true).getId();
    }

    public void letMembershipTypeGrantAnAccount(UUID membershipTypeId, String name) {
        var type = memberships.requireMembershipType(membershipTypeId);
        memberships.changeMembershipType(membershipTypeId, name, type.getRuleSetId(), true);
    }

    public void renameMembershipType(UUID membershipTypeId, String name) {
        var type = memberships.requireMembershipType(membershipTypeId);
        memberships.changeMembershipType(
                membershipTypeId, name, type.getRuleSetId(), type.isGrantsAccount());
    }

    public UUID membershipTypeMeasuredBy(String name, UUID ruleSetId) {
        return memberships.createMembershipType(name, ruleSetId, false).getId();
    }

    public void deactivateMembershipType(UUID membershipTypeId) {
        memberships.setMembershipTypeActive(membershipTypeId, false);
    }

    public boolean isMembershipTypeActive(UUID membershipTypeId) {
        return memberships.requireMembershipType(membershipTypeId).isActive();
    }

    public void assignMembership(UUID personId, UUID membershipTypeId, LocalDate startedOn) {
        roster.writeMembership(personId, membershipTypeId, new MembershipPeriod(startedOn, null));
    }

    public UUID addMembershipPeriod(UUID personId, UUID membershipTypeId, LocalDate startedOn, LocalDate endedOn) {
        return periods.add(personId, membershipTypeId, new MembershipPeriod(startedOn, endedOn)).id();
    }

    public void assignMembership(UUID personId, UUID membershipTypeId) {
        assignMembership(personId, membershipTypeId, DEFAULT_STARTED_ON);
    }

    public void endMembership(UUID personId) {
        roster.endMembership(personId);
    }

    public Optional<UUID> membershipTypeIdOf(UUID personId) {
        return memberships.membershipTypeIdOf(personId);
    }

    public Optional<LocalDate> membershipStartedOn(UUID personId) {
        return Optional.ofNullable(roster.person(personId).membership())
                .filter(RosterService.Membership::current)
                .map(RosterService.Membership::startedOn);
    }

    public UUID linkGuardian(UUID guardianPersonId, UUID dependantPersonId, Set<GuardianGrant> grants) {
        return guardianships.create(guardianPersonId, guardianPersonId, dependantPersonId, grants, null).id();
    }

    public UUID linkGuardianUntil(UUID guardianPersonId, UUID dependantPersonId, Set<GuardianGrant> grants,
                                  LocalDate endedOn) {
        return guardianships.create(guardianPersonId, guardianPersonId, dependantPersonId, grants, endedOn).id();
    }

    public void endGuardianship(UUID personId, UUID relationshipId) {
        guardianships.end(personId, relationshipId);
    }

    public int guardianshipCount(UUID personId) {
        return guardianships.guardianshipsOf(personId).size();
    }

    public Set<GuardianGrant> runningGrants(UUID guardianPersonId, UUID dependantPersonId) {
        return guardianships.guardianshipsOf(dependantPersonId).stream()
                .filter(guardianship -> guardianship.guardian().personId().equals(guardianPersonId))
                .filter(guardianship -> guardianship.state() == GuardianRelationshipState.RUNNING)
                .flatMap(guardianship -> guardianship.grants().stream())
                .collect(Collectors.toSet());
    }
}
