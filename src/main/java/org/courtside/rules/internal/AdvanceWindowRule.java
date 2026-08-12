package org.courtside.rules.internal;

import org.courtside.config.ClubTimeZone;
import org.courtside.rules.RuleContext;
import org.courtside.rules.RuleViolation;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Component
public class AdvanceWindowRule implements BookingRule {

    private final RuleParameterRepository ruleParameters;
    private final Clock clock;
    private final ClubTimeZone timeZone;

    public AdvanceWindowRule(RuleParameterRepository ruleParameters, Clock clock, ClubTimeZone timeZone) {
        this.ruleParameters = ruleParameters;
        this.clock = clock;
        this.timeZone = timeZone;
    }

    @Override
    public List<RuleViolation> check(RuleContext context) {
        Optional<Integer> maxDays = ruleParameters.findIntParameter(
                context.membershipTypeId(), RuleType.ADVANCE_WINDOW, "maxDays");
        if (maxDays.isEmpty()) {
            return List.of();
        }

        ZoneId zone = timeZone.zoneId();
        long daysAhead = ChronoUnit.DAYS.between(
                clock.instant().atZone(zone).toLocalDate(),
                context.slot().start().atZone(zone).toLocalDate());
        if (daysAhead >= maxDays.get()) {
            return List.of(new RuleViolation("booking.rule.advanceWindow.exceeded",
                    Map.of("maxDays", maxDays.get())));
        }
        return List.of();
    }
}
