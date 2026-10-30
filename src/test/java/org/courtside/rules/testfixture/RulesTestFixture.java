package org.courtside.rules.testfixture;

import lombok.RequiredArgsConstructor;
import org.courtside.rules.RuleType;
import org.courtside.rules.internal.RuleAdminService;
import org.courtside.rules.internal.RuleParameters;

import java.time.LocalTime;
import java.util.Arrays;
import java.util.Map;
import java.util.UUID;

@RequiredArgsConstructor
public class RulesTestFixture {

    private final RuleAdminService rules;

    private static final UUID STANDARD_RULE_SET = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000001");

    public void letMembersBookDaysAhead(int maxDays) {
        rules.setRule(STANDARD_RULE_SET, RuleType.ADVANCE_WINDOW, Map.of("maxDays", maxDays));
    }

    public UUID activeRuleSet(String name) {
        return rules.createRuleSet(name).getId();
    }

    public UUID ruleSetBarringCourtBookings(String name) {
        UUID ruleSetId = activeRuleSet(name);
        rules.setRule(ruleSetId, RuleType.NO_COURT_BOOKING, Map.of());
        return ruleSetId;
    }

    public UUID ruleSetBoundingBookingDuration(String name, int maxMinutes) {
        UUID ruleSetId = activeRuleSet(name);
        rules.setRule(ruleSetId, RuleType.MAX_BOOKING_DURATION, Map.of("maxMinutes", maxMinutes));
        return ruleSetId;
    }

    public UUID ruleSetLimitingBookingHours(String name, LocalTime earliestStart, LocalTime latestEnd) {
        UUID ruleSetId = activeRuleSet(name);
        rules.setRule(ruleSetId, RuleType.BOOKING_HOURS, Map.of(
                "earliestStart", earliestStart.toSecondOfDay() / 60,
                "latestEnd", latestEnd.toSecondOfDay() / 60));
        return ruleSetId;
    }

    public UUID ruleSetLimitingWeeklyHours(String name, int maxHours) {
        UUID ruleSetId = activeRuleSet(name);
        rules.setRule(ruleSetId, RuleType.WEEKLY_BOOKED_HOURS, Map.of("maxHours", maxHours));
        return ruleSetId;
    }

    public UUID ruleSetRequiringMinimumDuration(String name, int minDurationMinutes) {
        UUID ruleSetId = activeRuleSet(name);
        rules.setRule(ruleSetId, RuleType.MIN_BOOKING_DURATION, Map.of("minDurationMinutes", minDurationMinutes));
        return ruleSetId;
    }

    public void renameRuleSet(UUID ruleSetId, String name) {
        rules.changeRuleSet(ruleSetId, name);
    }

    public String ruleSetName(UUID ruleSetId) {
        return rules.requireRuleSet(ruleSetId).getName();
    }

    public void setCancellationDeadline(UUID ruleSetId, int minMinutes) {
        rules.setRule(ruleSetId, RuleType.CANCELLATION_DEADLINE,
                Map.of("minMinutes", minMinutes));
    }

    public void deactivate(UUID ruleSetId) {
        rules.setRuleSetActive(ruleSetId, false);
    }

    public UUID inactiveRuleSet(String name) {
        UUID ruleSetId = activeRuleSet(name);
        rules.setRuleSetActive(ruleSetId, false);
        return ruleSetId;
    }

    public long configurableRuleTypeCount() {
        return Arrays.stream(RuleType.values()).filter(RuleParameters::isConfigurablePerRuleSet).count();
    }
}
