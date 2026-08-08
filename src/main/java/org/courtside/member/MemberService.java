package org.courtside.member;

import org.courtside.member.internal.MembershipType;
import org.courtside.member.internal.MembershipTypeNameTakenException;
import org.courtside.member.internal.MembershipTypeNotFoundException;
import org.courtside.member.internal.MembershipTypeRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class MemberService {

    private static final String UNIQUE_NAME_CONSTRAINT = "membership_type_unique_name";
    private static final String RULE_SET_FOREIGN_KEY = "membership_type_rule_set_id_fkey";

    private final MemberRepository members;
    private final MembershipTypeRepository membershipTypes;
    private final RuleSetActivationRepository ruleSetActivation;

    public Optional<UUID> membershipTypeIdOf(UUID personId) {
        return members.findByPersonId(personId).map(Member::getMembershipTypeId);
    }

    public List<MembershipType> allMembershipTypes() {
        return membershipTypes.findAllByOrderByNameAsc();
    }

    @Transactional
    public MembershipType createMembershipType(String name, UUID ruleSetId) {
        requireActiveRuleSet(ruleSetId);
        return saveOrRejectTakenName(new MembershipType(name, ruleSetId));
    }

    @Transactional
    public MembershipType changeMembershipType(UUID membershipTypeId, String name, UUID ruleSetId) {
        MembershipType type = requireMembershipType(membershipTypeId);
        requireActiveRuleSet(ruleSetId);
        type.changeTo(name, ruleSetId);
        return saveOrRejectTakenName(type);
    }

    @Transactional
    public MembershipType setMembershipTypeActive(UUID membershipTypeId, boolean active) {
        MembershipType type = requireMembershipType(membershipTypeId);
        if (active) {
            type.activate();
        } else {
            type.deactivate();
        }
        return type;
    }

    public MembershipType requireMembershipType(UUID membershipTypeId) {
        return membershipTypes.findById(membershipTypeId)
                .orElseThrow(() -> new MembershipTypeNotFoundException(
                        "No membership type with id " + membershipTypeId));
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
        String message = e.getMostSpecificCause().getMessage();
        return message != null && message.contains(UNIQUE_NAME_CONSTRAINT);
    }

    private boolean isRuleSetInvalid(DataIntegrityViolationException e) {
        String message = e.getMostSpecificCause().getMessage();
        return message != null && message.contains(RULE_SET_FOREIGN_KEY);
    }
}
