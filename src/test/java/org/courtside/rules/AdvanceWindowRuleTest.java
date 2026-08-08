package org.courtside.rules;

import org.courtside.AbstractIntegrationTest;
import org.courtside.rules.internal.AdvanceWindowRule;
import org.courtside.rules.internal.RuleAdminService;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class AdvanceWindowRuleTest extends AbstractIntegrationTest {

    private static final UUID STANDARD = UUID.fromString("cccccccc-0000-0000-0000-000000000001");
    private static final UUID YOUTH = UUID.fromString("cccccccc-0000-0000-0000-000000000002");
    private static final UUID STANDARD_RULE_SET = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000001");
    private static final Instant NOW = Instant.parse("2026-05-12T10:00:00Z");

    @Autowired
    private AdvanceWindowRule rule;

    @Autowired
    private RuleAdminService ruleAdminService;

    @Test
    void givenADeactivatedRuleSet_whenBookingBeyondItsWindow_thenTheRuleStillGovernsExistingMembers() {
        // given — deactivation removes a rule set from the picker, it does not disarm it for a
        // membership type still pointing at it
        ruleAdminService.setRuleSetActive(STANDARD_RULE_SET, false);

        // when
        var violations = rule.check(contextFor(STANDARD, NOW.plus(10, ChronoUnit.DAYS)));

        // then
        assertThat(violations).extracting(RuleViolation::code)
                .containsExactly("booking.rule.advanceWindow.exceeded");
    }

    @Test
    void givenASevenDayWindow_whenBookingThreeDaysAhead_thenNoViolation() {
        // when
        var violations = rule.check(contextFor(STANDARD, NOW.plus(3, ChronoUnit.DAYS)));

        // then
        assertThat(violations).isEmpty();
    }

    @Test
    void givenASevenDayWindow_whenBookingTenDaysAhead_thenExceededViolation() {
        // when
        var violations = rule.check(contextFor(STANDARD, NOW.plus(10, ChronoUnit.DAYS)));

        // then
        assertThat(violations).extracting(RuleViolation::code)
                .containsExactly("booking.rule.advanceWindow.exceeded");
    }

    @Test
    void givenAYouthMembership_whenBookingFiveDaysAhead_thenTheShorterWindowApplies() {
        // when
        var violations = rule.check(contextFor(YOUTH, NOW.plus(5, ChronoUnit.DAYS)));

        // then
        assertThat(violations).extracting(RuleViolation::code)
                .containsExactly("booking.rule.advanceWindow.exceeded");
    }

    @Test
    void givenNoMembershipType_whenBookingFarAhead_thenTheRuleDoesNotApply() {
        // when
        var violations = rule.check(contextFor(null, NOW.plus(100, ChronoUnit.DAYS)));

        // then
        assertThat(violations).isEmpty();
    }

    private RuleContext contextFor(UUID membershipTypeId, Instant start) {
        return new RuleContext(
                UUID.randomUUID(),
                UUID.randomUUID(),
                new TimeSlot(start, start.plus(1, ChronoUnit.HOURS)),
                UUID.randomUUID(),
                membershipTypeId);
    }
}
