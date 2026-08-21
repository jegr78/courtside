package org.courtside.rules.internal;

import org.courtside.config.ClubTimeZone;
import org.courtside.rules.RuleContext;
import org.courtside.rules.RuleType;
import org.courtside.rules.RuleViolation;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class AdvanceWindowRuleUnitTest {

    @Test
    void givenSpringClockChange_whenBookingOnFirstDayOutsideWindow_thenExceededViolation() {
        // given
        UUID membershipTypeId = UUID.randomUUID();
        RuleParameterRepository parameters = mock();
        when(parameters.findIntParameter(membershipTypeId, RuleType.ADVANCE_WINDOW, "maxDays"))
                .thenReturn(Optional.of(2));
        ClubTimeZone timeZone = () -> ZoneId.of("Europe/Berlin");
        Clock clock = Clock.fixed(Instant.parse("2026-03-28T11:00:00Z"), ZoneOffset.UTC);
        AdvanceWindowRule rule = new AdvanceWindowRule(parameters, clock, timeZone);
        Instant start = Instant.parse("2026-03-30T05:00:00Z");
        RuleContext context = new RuleContext(UUID.randomUUID(), UUID.randomUUID(),
                new TimeSlot(start, start.plus(1, ChronoUnit.HOURS)), UUID.randomUUID(), membershipTypeId);

        // when
        var violations = rule.check(context);

        // then
        assertThat(violations).extracting(RuleViolation::code)
                .containsExactly("booking.rule.advanceWindow.exceeded");
    }
}
