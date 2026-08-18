package org.courtside.booking.internal;

import org.courtside.booking.BookingRuleCheck;
import org.courtside.booking.BookingRulesViolatedException;
import org.courtside.identity.Role;
import org.courtside.member.MemberService;
import org.courtside.rules.RuleContext;
import org.courtside.rules.RuleEngine;
import org.courtside.rules.RuleViolation;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
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

    public List<List<RuleViolation>> violationsFor(List<BookingRuleCheck> checks) {
        if (checks.isEmpty()) {
            return List.of();
        }
        boolean restrictionsApply = restrictionsApplyTo(checks.getFirst());
        if (checks.stream().anyMatch(check -> restrictionsApplyTo(check) != restrictionsApply)) {
            throw new IllegalStateException("A rule evaluation batch must use one restriction mode");
        }
        Map<UUID, Optional<UUID>> membershipTypes = new HashMap<>();
        List<RuleContext> contexts = checks.stream()
                .map(check -> contextOf(check, membershipTypes))
                .toList();
        return restrictionsApply
                ? ruleEngine.evaluate(contexts)
                : ruleEngine.evaluateNonOverridable(contexts);
    }

    public List<List<RuleViolation>> nonOverridableViolationsFor(List<BookingRuleCheck> checks) {
        return ruleEngine.evaluateNonOverridable(checks.stream()
                .map(this::contextOf)
                .toList());
    }

    public void requireNoViolations(BookingRuleCheck check) {
        requireEmpty(violationsFor(check));
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

    private RuleContext contextOf(BookingRuleCheck check, Map<UUID, Optional<UUID>> membershipTypes) {
        UUID membershipTypeId = check.bookedByPersonId() == null
                ? null
                : membershipTypes.computeIfAbsent(
                        check.bookedByPersonId(), members::membershipTypeIdOf).orElse(null);
        return new RuleContext(check.courtIds().getFirst(), check.cardId(), check.slot(),
                check.bookedBy(), membershipTypeId);
    }

    private static void requireEmpty(List<RuleViolation> violations) {
        if (!violations.isEmpty()) {
            throw new BookingRulesViolatedException(violations);
        }
    }
}
