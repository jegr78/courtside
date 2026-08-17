package org.courtside.booking.internal;

import org.courtside.booking.BookingRuleCheck;
import org.courtside.booking.BookingRulesViolatedException;
import org.courtside.identity.Role;
import org.courtside.member.MemberService;
import org.courtside.rules.RuleContext;
import org.courtside.rules.RuleEngine;
import org.courtside.rules.RuleViolation;
import org.courtside.shared.TimeSlot;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Set;
import java.util.UUID;

@Component
@RequiredArgsConstructor
public class BookingRuleGate {

    private final RuleEngine ruleEngine;
    private final MemberService members;

    public List<RuleViolation> violationsFor(BookingRuleCheck check) {
        RuleContext context = contextOf(check);
        return restrictionsApplyTo(check)
                ? ruleEngine.evaluate(context)
                : ruleEngine.evaluateNonOverridable(context);
    }

    public List<RuleViolation> nonOverridableViolationsFor(List<UUID> courtIds, UUID cardId,
                                                           TimeSlot slot, UUID bookedBy) {
        return ruleEngine.evaluateNonOverridable(contextOf(ownerCheck(courtIds, cardId, slot, bookedBy)));
    }

    public void requireNoViolations(BookingRuleCheck check) {
        requireEmpty(violationsFor(check));
    }

    public void requireNoNonOverridableViolations(List<UUID> courtIds, UUID cardId,
                                                  TimeSlot slot, UUID bookedBy) {
        requireEmpty(nonOverridableViolationsFor(courtIds, cardId, slot, bookedBy));
    }

    // A check without a person carries no membership.
    private static BookingRuleCheck ownerCheck(List<UUID> courtIds, UUID cardId,
                                               TimeSlot slot, UUID bookedBy) {
        return new BookingRuleCheck(courtIds, cardId, slot, bookedBy, null, Set.of());
    }

    // An ADMIN overrides every restriction; only opening hours and the slot grid bind them too.
    private boolean restrictionsApplyTo(BookingRuleCheck check) {
        return !check.callerRoles().contains(Role.ADMIN);
    }

    private RuleContext contextOf(BookingRuleCheck check) {
        UUID membershipTypeId = check.bookedByPersonId() == null
                ? null
                : members.membershipTypeIdOf(check.bookedByPersonId()).orElse(null);

        return new RuleContext(check.courtIds().getFirst(), check.cardId(), check.slot(),
                check.bookedBy(), membershipTypeId);
    }

    private static void requireEmpty(List<RuleViolation> violations) {
        if (!violations.isEmpty()) {
            throw new BookingRulesViolatedException(violations);
        }
    }
}
