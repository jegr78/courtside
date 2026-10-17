package org.courtside.member;

import lombok.RequiredArgsConstructor;
import org.courtside.identity.AccountSessions;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.UserAccountRepository;
import org.courtside.member.internal.MembershipPeriodNotFoundException;
import org.courtside.member.internal.MembershipPeriodsOverlapException;
import org.courtside.member.internal.PersonNotFoundException;
import org.courtside.shared.SqlConstraintViolation;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class MembershipPeriodService {

    static final String DISJOINT_PERIODS_CONSTRAINT = "member_periods_disjoint";

    private final MemberRepository members;
    private final PersonRepository persons;
    private final UserAccountRepository accounts;
    private final AccountSessions sessions;
    private final MemberService memberships;
    private final ApplicationEventPublisher events;

    public List<Period> periodsOf(UUID personId) {
        UUID id = requiredPersonId(personId);
        if (!persons.existsById(id)) {
            throw new PersonNotFoundException("No person with id " + id);
        }
        return members.findByPersonIdOrderByStartedOnAscIdAsc(id).stream().map(Period::of).toList();
    }

    @Transactional
    public Period add(UUID personId, UUID membershipTypeId, MembershipPeriod period) {
        UUID id = requiredPersonId(personId);
        MembershipPeriod requested = requiredPeriod(period).requireStart();
        requireLockedPerson(id);
        UUID typeId = memberships.requireAssignableMembershipType(membershipTypeId).getId();
        Member created = new Member(id, typeId, requested.startedOn());
        created.endOn(requested.endedOn());
        saveOrRejectOverlap(members, created);
        revokeSessionsOf(id);
        events.publishEvent(new RosterEvent.MembershipPeriodAdded(
                id, created.getId(), typeId, created.getStartedOn(), created.getEndedOn()));
        return Period.of(created);
    }

    @Transactional
    public Period correct(UUID personId, UUID periodId, UUID membershipTypeId, MembershipPeriod period) {
        UUID id = requiredPersonId(personId);
        MembershipPeriod requested = requiredPeriod(period).requireStart();
        requireLockedPerson(id);
        Member existing = requirePeriod(id, periodId);
        UUID typeId = existing.getMembershipTypeId().equals(membershipTypeId)
                ? memberships.requireMembershipType(membershipTypeId).getId()
                : memberships.requireAssignableMembershipType(membershipTypeId).getId();
        existing.assignTo(typeId);
        existing.correctPeriod(requested.startedOn(), requested.endedOn());
        saveOrRejectOverlap(members, existing);
        revokeSessionsOf(id);
        events.publishEvent(new RosterEvent.MembershipPeriodCorrected(
                id, existing.getId(), typeId, existing.getStartedOn(), existing.getEndedOn()));
        return Period.of(existing);
    }

    @Transactional
    public void remove(UUID personId, UUID periodId) {
        UUID id = requiredPersonId(personId);
        requireLockedPerson(id);
        Member existing = requirePeriod(id, periodId);
        members.delete(existing);
        members.flush();
        revokeSessionsOf(id);
        events.publishEvent(new RosterEvent.MembershipPeriodRemoved(id, existing.getId()));
    }

    private Member requirePeriod(UUID personId, UUID periodId) {
        if (periodId == null) {
            throw new IllegalStateException("A membership period must be named by an id");
        }
        return members.findByIdAndPersonId(periodId, personId)
                .orElseThrow(() -> new MembershipPeriodNotFoundException(
                        "No membership period " + periodId + " for person " + personId));
    }

    static void saveOrRejectOverlap(MemberRepository members, Member member) {
        try {
            members.saveAndFlush(member);
        } catch (DataIntegrityViolationException e) {
            if (SqlConstraintViolation.matches(e, SqlConstraintViolation.EXCLUSION_VIOLATION,
                    DISJOINT_PERIODS_CONSTRAINT)) {
                throw new MembershipPeriodsOverlapException("membershipPeriod.overlaps", Map.of());
            }
            throw e;
        }
    }

    private void requireLockedPerson(UUID personId) {
        persons.findWithLockById(personId)
                .orElseThrow(() -> new PersonNotFoundException("No person with id " + personId));
    }

    private void revokeSessionsOf(UUID personId) {
        accounts.findWithLockByPersonIdIn(List.of(personId)).forEach(sessions::revoke);
    }

    private static UUID requiredPersonId(UUID personId) {
        if (personId == null) {
            throw new IllegalStateException("A person must be named by an id");
        }
        return personId;
    }

    private static MembershipPeriod requiredPeriod(MembershipPeriod period) {
        if (period == null) {
            throw new IllegalStateException("A membership period must be written with its dates");
        }
        return period;
    }

    public record Period(UUID id, UUID membershipTypeId, LocalDate startedOn, LocalDate endedOn) {

        static Period of(Member member) {
            return new Period(member.getId(), member.getMembershipTypeId(),
                    member.getStartedOn(), member.getEndedOn());
        }
    }
}
