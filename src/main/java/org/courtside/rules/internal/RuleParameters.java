package org.courtside.rules.internal;

import org.courtside.rules.RuleType;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class RuleParameters {

    private record Bounds(int min, int max) {
    }

    public record Parameter(String name, int minimum, int maximum) {
    }

    // NO_COURT_BOOKING carries no bounds because it carries no parameters: a club switches it on
    // by putting it in a rule set and off by taking it out, and any value sent with it is refused.
    private static final Map<RuleType, Map<String, Bounds>> CONTRACT = Map.of(
            RuleType.ADVANCE_WINDOW, Map.of("maxDays", new Bounds(1, 365)),
            RuleType.MAX_OPEN_BOOKINGS, Map.of("limit", new Bounds(1, 99)),
            RuleType.MAX_BOOKING_DURATION, Map.of("maxMinutes", new Bounds(5, 1440)),
            RuleType.CANCELLATION_DEADLINE, Map.of("minMinutes", new Bounds(0, 525600)),
            RuleType.NO_COURT_BOOKING, Map.of());

    private RuleParameters() {
    }

    public static boolean isConfigurablePerRuleSet(RuleType type) {
        return CONTRACT.containsKey(type);
    }

    public static List<Parameter> parametersOf(RuleType type) {
        return CONTRACT.getOrDefault(type, Map.of()).entrySet().stream()
                .map(entry -> new Parameter(entry.getKey(), entry.getValue().min(), entry.getValue().max()))
                .toList();
    }

    public static Map<String, Integer> validated(RuleType type, Map<String, Integer> params) {
        Map<String, Bounds> expected = CONTRACT.get(type);
        if (expected == null) {
            throw new RuleParameterInvalidException("rule.parameters.typeNotConfigurable",
                    Map.of("ruleType", type.name()));
        }
        params.keySet().stream()
                .filter(key -> !expected.containsKey(key))
                .findFirst()
                .ifPresent(key -> {
                    throw new RuleParameterInvalidException("rule.parameters.unknownParameter",
                            Map.of("ruleType", type.name()));
                });

        Map<String, Integer> validated = new LinkedHashMap<>();
        expected.forEach((key, bounds) -> {
            Integer value = params.get(key);
            if (value == null) {
                throw new RuleParameterInvalidException("rule.parameters.missingParameter",
                        Map.of("ruleType", type.name(), "parameter", key));
            }
            if (value < bounds.min() || value > bounds.max()) {
                throw new RuleParameterInvalidException("rule.parameters.outOfBounds",
                        Map.of("ruleType", type.name(), "parameter", key,
                                "min", bounds.min(), "max", bounds.max()));
            }
            validated.put(key, value);
        });
        return Map.copyOf(validated);
    }
}
