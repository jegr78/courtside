package org.courtside.rules.internal;

import org.courtside.rules.RuleContext;
import org.courtside.rules.RuleViolation;
import org.courtside.config.BookingGridSettings;
import org.courtside.config.BookingSlotDuration;
import org.courtside.config.ClubTimeZone;
import org.springframework.stereotype.Component;

import java.time.ZonedDateTime;
import java.util.List;
import java.util.Map;

@Component
public class SlotGridRule implements BookingRule {

    private final BookingGridSettings bookingGridSettings;
    private final ClubTimeZone timeZone;

    public SlotGridRule(BookingGridSettings bookingGridSettings, ClubTimeZone timeZone) {
        this.bookingGridSettings = bookingGridSettings;
        this.timeZone = timeZone;
    }

    @Override
    public boolean isOverridable() {
        return false;
    }

    @Override
    public List<RuleViolation> check(RuleContext context) {
        ZonedDateTime start = context.slot().start().atZone(timeZone.zoneId());
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
