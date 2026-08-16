package org.courtside.rules;

import org.courtside.rules.internal.BookingRule;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class RuleEngineTest {

    private static final RuleContext ANY_CONTEXT = new RuleContext(
            UUID.randomUUID(),
            UUID.randomUUID(),
            new TimeSlot(Instant.parse("2026-05-12T16:00:00Z"),
                         Instant.parse("2026-05-12T17:00:00Z")),
            UUID.randomUUID(),
            null);

    @Test
    void givenOnlyPassingRules_whenEvaluating_thenNoViolationsAreReturned() {
        // given
        RuleEngine engine = new RuleEngine(List.of(passingRule(), passingRule()));

        // when
        var violations = engine.evaluate(ANY_CONTEXT);

        // then
        assertThat(violations).isEmpty();
    }

    @Test
    void givenTwoFailingRules_whenEvaluating_thenBothViolationsAreCollected() {
        // given
        RuleEngine engine = new RuleEngine(List.of(
                failingRule("booking.rule.first"),
                failingRule("booking.rule.second"),
                passingRule()));

        // when
        var violations = engine.evaluate(ANY_CONTEXT);

        // then
        assertThat(violations).extracting(RuleViolation::code)
                .containsExactly("booking.rule.first", "booking.rule.second");
    }

    @Test
    void givenARuleWithParameters_whenEvaluating_thenParametersSurviveInTheViolation() {
        // given
        RuleEngine engine = new RuleEngine(List.of(
                context -> List.of(new RuleViolation("booking.rule.limit", Map.of("limit", 2)))));

        // when
        var violations = engine.evaluate(ANY_CONTEXT);

        // then
        assertThat(violations).singleElement()
                .extracting(RuleViolation::params)
                .satisfies(params -> assertThat(params).containsEntry("limit", 2));
    }

    @Test
    void givenOverridableAndNonOverridableFailures_whenEvaluatingMandatoryRules_thenOnlyMandatoryViolationsRemain() {
        // given
        BookingRule mandatory = new BookingRule() {
            @Override
            public List<RuleViolation> check(RuleContext context) {
                return List.of(new RuleViolation("booking.rule.mandatory", Map.of()));
            }

            @Override
            public boolean isOverridable() {
                return false;
            }
        };
        RuleEngine engine = new RuleEngine(List.of(failingRule("booking.rule.overridable"), mandatory));

        // when
        var violations = engine.evaluateNonOverridable(ANY_CONTEXT);

        // then
        assertThat(violations).extracting(RuleViolation::code)
                .containsExactly("booking.rule.mandatory");
    }

    private BookingRule passingRule() {
        return context -> List.of();
    }

    private BookingRule failingRule(String code) {
        return context -> List.of(new RuleViolation(code, Map.of()));
    }
}
