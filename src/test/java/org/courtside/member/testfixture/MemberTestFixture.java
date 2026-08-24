package org.courtside.member.testfixture;

import lombok.RequiredArgsConstructor;
import org.courtside.member.MemberRepository;
import org.courtside.member.MemberService;
import org.courtside.member.MembershipPeriod;
import org.courtside.member.RosterChangeSet;
import org.courtside.member.RosterService;
import org.courtside.member.RosterSyncService;

import org.courtside.identity.Role;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

@RequiredArgsConstructor
public class MemberTestFixture {

    private static final LocalDate DEFAULT_STARTED_ON = LocalDate.of(2026, 1, 1);

    private final MemberService memberships;
    private final RosterService roster;
    private final MemberRepository members;
    private final RosterSyncService sync;

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
        return members.findCurrentByPersonId(personId).map(member -> member.getStartedOn());
    }
}
