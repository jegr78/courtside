package org.courtside.rules;

import org.courtside.rules.internal.RuleParameterInvalidException;
import org.courtside.rules.internal.RuleParameters;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.ToIntFunction;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class RuleParametersTest {

    @Test
    void givenACancellationDeadline_whenValidating_thenZeroAndOneYearAreSupported() {
        // when / then
        assertThat(RuleParameters.validated(
                RuleType.CANCELLATION_DEADLINE, Map.of("minMinutes", 0)))
                .containsExactly(Map.entry("minMinutes", 0));
        assertThat(RuleParameters.validated(
                RuleType.CANCELLATION_DEADLINE, Map.of("minMinutes", 525600)))
                .containsExactly(Map.entry("minMinutes", 525600));
    }

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

    static Stream<RuleType> everyConfigurableTypeWithParameters() {
        return Stream.of(RuleType.values())
                .filter(RuleParameters::isConfigurablePerRuleSet)
                .filter(type -> !RuleParameters.parametersOf(type).isEmpty());
    }

    @ParameterizedTest
    @MethodSource("everyConfigurableTypeWithParameters")
    void givenEveryConfigurableRuleType_whenValidatingItsBounds_thenBothEndsAreAccepted(RuleType type) {
        // given
        List<RuleParameters.Parameter> parameters = RuleParameters.parametersOf(type);

        // when / then
        assertThat(RuleParameters.validated(type, valuesAt(parameters, RuleParameters.Parameter::minimum)))
                .as("the minimum of %s must be a value a club can set", type)
                .isEqualTo(valuesAt(parameters, RuleParameters.Parameter::minimum));
        assertThat(RuleParameters.validated(type, valuesAt(parameters, RuleParameters.Parameter::maximum)))
                .as("the maximum of %s must be a value a club can set", type)
                .isEqualTo(valuesAt(parameters, RuleParameters.Parameter::maximum));
    }

    @ParameterizedTest
    @MethodSource("everyConfigurableTypeWithParameters")
    void givenEveryConfigurableRuleType_whenAValueLeavesItsRange_thenItIsRejectedNamingTheRange(RuleType type) {
        // given
        List<RuleParameters.Parameter> parameters = RuleParameters.parametersOf(type);

        // when / then
        for (RuleParameters.Parameter parameter : parameters) {
            assertRejected(type, below(parameters, parameter), "rule.parameters.outOfBounds",
                    Map.of("ruleType", type.name(), "parameter", parameter.name(),
                            "min", parameter.minimum(), "max", parameter.maximum()));
            assertRejected(type, above(parameters, parameter), "rule.parameters.outOfBounds",
                    Map.of("ruleType", type.name(), "parameter", parameter.name(),
                            "min", parameter.minimum(), "max", parameter.maximum()));
        }
    }

    @ParameterizedTest
    @MethodSource("everyConfigurableTypeWithParameters")
    void givenEveryConfigurableRuleType_whenAParameterIsMissingOrUnknown_thenItIsRejected(RuleType type) {
        // given
        List<RuleParameters.Parameter> parameters = RuleParameters.parametersOf(type);
        Map<String, Integer> complete = valuesAt(parameters, RuleParameters.Parameter::minimum);

        // when / then — which parameter it names first is the contract map's business, not ours
        assertThatThrownBy(() -> RuleParameters.validated(type, Map.of()))
                .isInstanceOf(RuleParameterInvalidException.class)
                .satisfies(thrown -> {
                    RuleParameterInvalidException invalid = (RuleParameterInvalidException) thrown;
                    assertThat(invalid.getCode()).isEqualTo("rule.parameters.missingParameter");
                    assertThat(invalid.getParams()).containsEntry("ruleType", type.name());
                    assertThat(invalid.getParams().get("parameter"))
                            .isIn(parameters.stream().map(RuleParameters.Parameter::name).toList());
                });
        Map<String, Integer> withAStranger = new LinkedHashMap<>(complete);
        withAStranger.put("aParameterNoRuleTypeCarries", 1);
        assertRejected(type, withAStranger, "rule.parameters.unknownParameter",
                Map.of("ruleType", type.name()));
    }

    private static void assertRejected(RuleType type, Map<String, Integer> params,
                                       String code, Map<String, Object> expectedParams) {
        assertThatThrownBy(() -> RuleParameters.validated(type, params))
                .isInstanceOf(RuleParameterInvalidException.class)
                .satisfies(thrown -> {
                    RuleParameterInvalidException invalid = (RuleParameterInvalidException) thrown;
                    assertThat(invalid.getCode()).isEqualTo(code);
                    assertThat(invalid.getParams()).isEqualTo(expectedParams);
                });
    }

    private static Map<String, Integer> valuesAt(
            List<RuleParameters.Parameter> parameters,
            ToIntFunction<RuleParameters.Parameter> end) {
        Map<String, Integer> values = new LinkedHashMap<>();
        parameters.forEach(parameter -> values.put(parameter.name(), end.applyAsInt(parameter)));
        return values;
    }

    private static Map<String, Integer> below(
            List<RuleParameters.Parameter> parameters, RuleParameters.Parameter offender) {
        Map<String, Integer> values = valuesAt(parameters, RuleParameters.Parameter::minimum);
        values.put(offender.name(), offender.minimum() - 1);
        return values;
    }

    private static Map<String, Integer> above(
            List<RuleParameters.Parameter> parameters, RuleParameters.Parameter offender) {
        Map<String, Integer> values = valuesAt(parameters, RuleParameters.Parameter::minimum);
        values.put(offender.name(), offender.maximum() + 1);
        return values;
    }
}
