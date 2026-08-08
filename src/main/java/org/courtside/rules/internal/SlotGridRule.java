package org.courtside.rules.internal;

import org.courtside.rules.RuleContext;
import org.courtside.rules.RuleViolation;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.Map;

@Component
public class SlotGridRule implements BookingRule {

    private final int slotMinutes;
    private final ZoneId zone;

    public SlotGridRule(@Value("${courtside.booking.slot-minutes}") int slotMinutes,
                        @Value("${courtside.booking.time-zone}") String zone) {
        this.slotMinutes = slotMinutes;
        this.zone = ZoneId.of(zone);
    }

    @Override
    public boolean isOverridable() {
        return false;
    }

    @Override
    public List<RuleViolation> check(RuleContext context) {
        ZonedDateTime start = context.slot().start().atZone(zone);

        boolean aligned = start.getMinute() % slotMinutes == 0
                && start.getSecond() == 0
                && start.getNano() == 0;
        if (!aligned) {
            return List.of(new RuleViolation("booking.rule.slotGrid.misaligned",
                    Map.of("slotMinutes", slotMinutes)));
        }

        if (context.slot().duration().toMinutes() % slotMinutes != 0) {
            return List.of(new RuleViolation("booking.rule.slotGrid.duration",
                    Map.of("slotMinutes", slotMinutes)));
        }
        return List.of();
    }
}
