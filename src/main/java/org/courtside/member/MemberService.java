package org.courtside.member;

import org.courtside.config.ClubTimeZone;
import org.courtside.config.RuleSetForPeopleWithoutAMembershipType;
import org.courtside.member.internal.MembershipType;
import org.courtside.member.internal.MembershipTypeInactiveException;
import org.courtside.member.internal.MembershipTypeNameTakenException;
import org.courtside.member.internal.MembershipTypeNotFoundException;
import org.courtside.member.internal.MembershipTypeRepository;
import org.courtside.shared.SqlConstraintViolation;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class MemberService {

    private static final String UNIQUE_NAME_CONSTRAINT = "membership_type_unique_name";
    private static final String RULE_SET_FOREIGN_KEY = "membership_type_rule_set_id_fkey";

    private final MemberRepository members;
    private final MembershipTypeRepository membershipTypes;
    private final RuleSetActivationRepository ruleSetActivation;
    private final ApplicationEventPublisher events;
    private final Clock clock;
    private final ClubTimeZone clubTimeZone;
    private final RuleSetForPeopleWithoutAMembershipType withoutAMembershipType;

    public Optional<UUID> membershipTypeIdOf(UUID personId) {
        return members.findValidOn(personId, today()).map(Member::getMembershipTypeId);
    }

    public Optional<UUID> membershipTypeIdFor(UUID personId, LocalDate day) {
        if (day == null) {
            throw new IllegalStateException("A membership type is read for a day");
        }
        return membershipTypesOf(personId).apply(day);
    }

    public Function<LocalDate, Optional<UUID>> membershipTypesOf(UUID personId) {
        LocalDate today = today();
        List<Member> periods = members.findByPersonIdOrderByStartedOnAscIdAsc(personId);
        Optional<UUID> current = periods.stream().filter(member -> member.isValidOn(today)).findFirst()
                .map(Member::getMembershipTypeId);
        if (current.isEmpty()) {
            return day -> Optional.empty();
        }
        // Past the end, the rules a club bound for people without a type apply; without any, today's type keeps binding.
        Optional<UUID> uncovered = withoutAMembershipType.ruleSetId().isPresent() ? Optional.empty() : current;
        return day -> periods.stream().filter(member -> member.isValidOn(day)).findFirst()
                .map(Member::getMembershipTypeId)
                .or(() -> uncovered);
    }

    public Map<UUID, MembershipStanding> standingsOf(List<UUID> personIds) {
        LocalDate today = today();
        return members.findByPersonIdIn(personIds).stream()
                .collect(Collectors.groupingBy(Member::getPersonId)).entrySet().stream()
                .collect(Collectors.toMap(Map.Entry::getKey, entry -> {
                    Member member = representativePeriod(entry.getValue(), today);
                    return new MembershipStanding(member.getMembershipTypeId(), member.isValidOn(today));
                }));
    }

    static Member representativePeriod(List<Member> periods, LocalDate today) {
        return periods.stream().filter(member -> member.isValidOn(today)).findFirst()
                .or(() -> periods.stream().filter(member -> member.getStartedOn().isAfter(today))
                        .min(Comparator.comparing(Member::getStartedOn)))
                .or(() -> periods.stream().max(Comparator.comparing(Member::getStartedOn)))
                .orElse(null);
    }

    LocalDate today() {
        return LocalDate.now(clock.withZone(clubTimeZone.zoneId()));
    }

    public List<MemberParticipant> findParticipants(String query, UUID searcherAccountId) {
        String normalized = query.trim().toLowerCase(Locale.ROOT);
        if (normalized.isEmpty()) {
            return List.of();
        }
        return members.findParticipants(escapeLikePattern(normalized), searcherAccountId, today(),
                PageRequest.of(0, 20));
    }

    private String escapeLikePattern(String value) {
        return value.replace("!", "!!").replace("%", "!%").replace("_", "!_");
    }

    public Set<UUID> membershipTypeIdsGrantingAnAccount() {
        return membershipTypes.findAllByOrderByNameAsc().stream()
                .filter(MembershipType::isGrantsAccount)
                .map(MembershipType::getId)
                .collect(Collectors.toUnmodifiableSet());
    }

    public Set<UUID> activeMembershipTypeIds() {
        return membershipTypes.findAllByOrderByNameAsc().stream()
                .filter(MembershipType::isActive)
                .map(MembershipType::getId)
                .collect(Collectors.toUnmodifiableSet());
    }

    public boolean knowsMembershipType(UUID membershipTypeId) {
        return membershipTypeId != null && membershipTypes.existsById(membershipTypeId);
    }

    public Optional<String> membershipTypeNameOf(UUID membershipTypeId) {
        return membershipTypeId == null
                ? Optional.empty()
                : membershipTypes.findById(membershipTypeId).map(MembershipType::getName);
    }

    public List<MembershipType> allMembershipTypes() {
        return membershipTypes.findAllByOrderByNameAsc();
    }

    @Transactional
    public MembershipType createMembershipType(String name, UUID ruleSetId, boolean grantsAccount) {
        requireActiveRuleSet(ruleSetId);
        MembershipType saved = saveOrRejectTakenName(
                new MembershipType(name, ruleSetId, grantsAccount));
        events.publishEvent(new MembershipTypeEvent.Added(saved.getId(), saved.getRuleSetId()));
        return saved;
    }

    @Transactional
    public MembershipType changeMembershipType(UUID membershipTypeId, String name, UUID ruleSetId,
                                               boolean grantsAccount) {
        MembershipType type = requireMembershipType(membershipTypeId);
        List<String> changedFields = new ArrayList<>();
        if (!Objects.equals(type.getName(), name)) {
            changedFields.add("name");
        }
        if (type.isGrantsAccount() != grantsAccount) {
            changedFields.add("grantsAccount");
        }
        boolean ruleSetChanged = !Objects.equals(type.getRuleSetId(), ruleSetId);
        // Only a rule set this type is newly pointing at. Keeping a retired one it already names is
        // not an assignment, and refusing it would stop a club correcting the name beside it.
        if (ruleSetChanged) {
            requireActiveRuleSet(ruleSetId);
        }
        type.changeTo(name, ruleSetId, grantsAccount);
        MembershipType saved = saveOrRejectTakenName(type);
        if (!changedFields.isEmpty() || ruleSetChanged) {
            events.publishEvent(
                    new MembershipTypeEvent.Changed(saved.getId(), saved.getRuleSetId(), changedFields));
        }
        return saved;
    }

    @Transactional
    public MembershipType setMembershipTypeActive(UUID membershipTypeId, boolean active) {
        MembershipType type = requireMembershipType(membershipTypeId);
        if (type.isActive() == active) {
            return type;
        }
        if (active) {
            type.activate();
        } else {
            type.deactivate();
        }
        events.publishEvent(new MembershipTypeEvent.AvailabilityChanged(type.getId(), active));
        return type;
    }

    public MembershipType requireMembershipType(UUID membershipTypeId) {
        if (membershipTypeId == null) {
            throw new IllegalStateException("A membership type must be named by an id");
        }
        return membershipTypes.findById(membershipTypeId)
                .orElseThrow(() -> new MembershipTypeNotFoundException(
                        "No membership type with id " + membershipTypeId));
    }

    MembershipType requireAssignableMembershipType(UUID membershipTypeId) {
        MembershipType type = requireMembershipType(membershipTypeId);
        if (!type.isActive()) {
            throw new MembershipTypeInactiveException(
                    "membershipType.inactive", Map.of("field", "membershipTypeId"));
        }
        return type;
    }

    private void requireActiveRuleSet(UUID ruleSetId) {
        if (ruleSetId != null && ruleSetActivation.isInactive(ruleSetId)) {
            throw new MembershipTypeRuleSetInactiveException(
                    "membershipType.ruleSet.inactive", Map.of("field", "ruleSetId"));
        }
    }

    private MembershipType saveOrRejectTakenName(MembershipType type) {
        try {
            return membershipTypes.saveAndFlush(type);
        } catch (DataIntegrityViolationException e) {
            if (isNameTaken(e)) {
                throw new MembershipTypeNameTakenException(
                        "Membership type name '" + type.getName() + "' is already taken", e);
            }
            if (isRuleSetInvalid(e)) {
                throw new MembershipTypeRuleSetInvalidException(
                        "membershipType.ruleSet.unresolvable", Map.of("field", "ruleSetId"), e);
            }
            throw e;
        }
    }

    private boolean isNameTaken(DataIntegrityViolationException e) {
        return SqlConstraintViolation.matches(
                e, SqlConstraintViolation.UNIQUE_VIOLATION, UNIQUE_NAME_CONSTRAINT);
    }

    private boolean isRuleSetInvalid(DataIntegrityViolationException e) {
        return SqlConstraintViolation.matches(
                e, SqlConstraintViolation.FOREIGN_KEY_VIOLATION, RULE_SET_FOREIGN_KEY);
    }

    public record MembershipStanding(UUID membershipTypeId, boolean current) {
    }
}
