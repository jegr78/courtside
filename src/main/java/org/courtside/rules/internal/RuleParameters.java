package org.courtside.rules.internal;

import org.courtside.rules.RuleType;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

public final class RuleParameters {

    public enum Kind {
        NUMBER,
        // Minutes after midnight in the club's time zone.
        TIME_OF_DAY
    }

    public record Parameter(String name, int minimum, int maximum, Kind kind) {
    }

    // NO_COURT_BOOKING carries no parameters: a club switches it on by putting it in a rule set
    // and off by taking it out, and any value sent with it is refused.
    private static final Map<RuleType, List<Parameter>> CONTRACT = Map.of(
            RuleType.ADVANCE_WINDOW, List.of(new Parameter("maxDays", 1, 365, Kind.NUMBER)),
            RuleType.MAX_OPEN_BOOKINGS, List.of(new Parameter("limit", 1, 99, Kind.NUMBER)),
            RuleType.MAX_BOOKING_DURATION, List.of(new Parameter("maxMinutes", 5, 1440, Kind.NUMBER)),
            RuleType.CANCELLATION_DEADLINE, List.of(new Parameter("minMinutes", 0, 525600, Kind.NUMBER)),
            RuleType.NO_COURT_BOOKING, List.of(),
            RuleType.BOOKING_HOURS, List.of(
                    new Parameter("earliestStart", 0, 1438, Kind.TIME_OF_DAY),
                    new Parameter("latestEnd", 1, 1439, Kind.TIME_OF_DAY)));

    private RuleParameters() {
    }

    public static boolean isConfigurablePerRuleSet(RuleType type) {
        return CONTRACT.containsKey(type);
    }

    public static List<Parameter> parametersOf(RuleType type) {
        return CONTRACT.getOrDefault(type, List.of());
    }

    public static Map<String, Integer> validated(RuleType type, Map<String, Integer> params) {
        List<Parameter> expected = CONTRACT.get(type);
        if (expected == null) {
            throw new RuleParameterInvalidException("rule.parameters.typeNotConfigurable",
                    Map.of("ruleType", type.name()));
        }
        Set<String> names = expected.stream().map(Parameter::name).collect(Collectors.toSet());
        params.keySet().stream()
                .filter(key -> !names.contains(key))
                .findFirst()
                .ifPresent(key -> {
                    throw new RuleParameterInvalidException("rule.parameters.unknownParameter",
                            Map.of("ruleType", type.name()));
                });

        Map<String, Integer> validated = new LinkedHashMap<>();
        expected.forEach(parameter -> {
            Integer value = params.get(parameter.name());
            if (value == null) {
                throw new RuleParameterInvalidException("rule.parameters.missingParameter",
                        Map.of("ruleType", type.name(), "parameter", parameter.name()));
            }
            if (value < parameter.minimum() || value > parameter.maximum()) {
                throw new RuleParameterInvalidException("rule.parameters.outOfBounds",
                        Map.of("ruleType", type.name(), "parameter", parameter.name(),
                                "min", parameter.minimum(), "max", parameter.maximum()));
            }
            validated.put(parameter.name(), value);
        });
        if (type == RuleType.BOOKING_HOURS
                && validated.get("latestEnd") <= validated.get("earliestStart")) {
            throw new RuleParameterInvalidException("rule.parameters.windowEndsBeforeItStarts",
                    Map.of("ruleType", type.name()));
        }
        return Map.copyOf(validated);
    }
}
