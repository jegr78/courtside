package org.courtside.rules.internal;

import org.courtside.rules.RuleContext;
import org.courtside.rules.RuleViolation;
import org.courtside.config.BookingGridSettings;
import org.courtside.config.BookingSlotDuration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.Map;

@Component
public class SlotGridRule implements BookingRule {

    private final BookingGridSettings bookingGridSettings;
    private final ZoneId zone;

    public SlotGridRule(BookingGridSettings bookingGridSettings,
                        @Value("${courtside.booking.time-zone}") String zone) {
        this.bookingGridSettings = bookingGridSettings;
        this.zone = ZoneId.of(zone);
    }

    @Override
    public boolean isOverridable() {
        return false;
    }

    @Override
    public List<RuleViolation> check(RuleContext context) {
        ZonedDateTime start = context.slot().start().atZone(zone);
        BookingSlotDuration slotDuration = bookingGridSettings.slotDuration();
        int slotMinutes = slotDuration.minutes();

        if (!slotDuration.isAligned(start.toLocalTime())) {
            return List.of(new RuleViolation("booking.rule.slotGrid.misaligned",
                    Map.of("slotMinutes", slotMinutes)));
        }

        if (!slotDuration.containsWholeSlots(context.slot().duration())) {
            return List.of(new RuleViolation("booking.rule.slotGrid.duration",
                    Map.of("slotMinutes", slotMinutes)));
        }
        return List.of();
    }
}
