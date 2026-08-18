package org.courtside.member.testfixture;

import lombok.RequiredArgsConstructor;
import org.courtside.member.MemberRepository;
import org.courtside.member.MemberService;
import org.courtside.member.MembershipPeriod;
import org.courtside.member.RosterService;

import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;

@RequiredArgsConstructor
public class MemberTestFixture {

    private static final LocalDate DEFAULT_STARTED_ON = LocalDate.of(2026, 1, 1);

    private final MemberService memberships;
    private final RosterService roster;
    private final MemberRepository members;

    public UUID createMembershipType(String name) {
        return memberships.createMembershipType(name, null).getId();
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
