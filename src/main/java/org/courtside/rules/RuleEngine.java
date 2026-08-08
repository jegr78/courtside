package org.courtside.rules;

import org.courtside.rules.internal.BookingRule;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
public class RuleEngine {

    private final List<BookingRule> rules;

    public RuleEngine(List<BookingRule> rules) {
        this.rules = List.copyOf(rules);
    }

    // Evaluation never short-circuits: a member should see everything that is wrong at once.
    public List<RuleViolation> evaluate(RuleContext context) {
        return evaluate(context, rules);
    }

    public List<RuleViolation> evaluateNonOverridable(RuleContext context) {
        return evaluate(context, rules.stream().filter(rule -> !rule.isOverridable()).toList());
    }

    private List<RuleViolation> evaluate(RuleContext context, List<BookingRule> applicable) {
        return applicable.stream()
                .flatMap(rule -> rule.check(context).stream())
                .toList();
    }
}
