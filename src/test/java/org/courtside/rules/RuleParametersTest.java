package org.courtside.rules;

import org.courtside.rules.internal.RuleParameterInvalidException;
import org.courtside.rules.internal.RuleParameters;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class RuleParametersTest {

    @Test
    void givenTheParameterAnAdvanceWindowNeeds_whenValidating_thenItIsAccepted() {
        // when / then
        assertThat(RuleParameters.validated(RuleType.ADVANCE_WINDOW, Map.of("maxDays", 7)))
                .containsExactly(Map.entry("maxDays", 7));
    }

    @Test
    void givenAMisspelledParameter_whenValidating_thenItIsRejectedWithACodeNotTheRawKey() {
        // when / then
        assertThatThrownBy(() ->
                RuleParameters.validated(RuleType.ADVANCE_WINDOW, Map.of("maxdays", 7)))
                .isInstanceOf(RuleParameterInvalidException.class)
                .extracting(exception -> ((RuleParameterInvalidException) exception).getCode())
                .isEqualTo("rule.parameters.unknownParameter");
    }

    @Test
    void givenAMissingParameter_whenValidating_thenItIsRejectedNamingTheParameter() {
        // when / then
        assertThatThrownBy(() -> RuleParameters.validated(RuleType.ADVANCE_WINDOW, Map.of()))
                .isInstanceOf(RuleParameterInvalidException.class)
                .extracting(exception -> ((RuleParameterInvalidException) exception).getParams())
                .isEqualTo(Map.of("ruleType", "ADVANCE_WINDOW", "parameter", "maxDays"));
    }

    @Test
    void givenAValueOutsideTheAllowedRange_whenValidating_thenItIsRejected() {
        // when / then
        assertThatThrownBy(() ->
                RuleParameters.validated(RuleType.ADVANCE_WINDOW, Map.of("maxDays", 0)))
                .isInstanceOf(RuleParameterInvalidException.class)
                .extracting(exception -> ((RuleParameterInvalidException) exception).getCode())
                .isEqualTo("rule.parameters.outOfBounds");
    }

    @Test
    void givenAParameterlessRuleType_whenValidatingWithoutParameters_thenNothingIsCarried() {
        // when
        Map<String, Integer> validated = RuleParameters.validated(RuleType.NO_COURT_BOOKING, Map.of());

        // then
        assertThat(validated).isEmpty();
        assertThat(RuleParameters.isConfigurablePerRuleSet(RuleType.NO_COURT_BOOKING)).isTrue();
        assertThat(RuleParameters.parametersOf(RuleType.NO_COURT_BOOKING)).isEmpty();
    }

    @Test
    void givenAParameterlessRuleType_whenAValueIsSentWithIt_thenItIsRejected() {
        // when / then
        assertThatThrownBy(() ->
                RuleParameters.validated(RuleType.NO_COURT_BOOKING, Map.of("limit", 0)))
                .isInstanceOf(RuleParameterInvalidException.class)
                .extracting(exception -> ((RuleParameterInvalidException) exception).getCode())
                .isEqualTo("rule.parameters.unknownParameter");
    }

    @Test
    void givenARuleTypeThatIsNotConfiguredPerRuleSet_whenValidating_thenItIsRejected() {
        // when / then
        assertThatThrownBy(() -> RuleParameters.validated(RuleType.OPENING_HOURS, Map.of()))
                .isInstanceOf(RuleParameterInvalidException.class)
                .extracting(exception -> ((RuleParameterInvalidException) exception).getCode())
                .isEqualTo("rule.parameters.typeNotConfigurable");
    }
}
