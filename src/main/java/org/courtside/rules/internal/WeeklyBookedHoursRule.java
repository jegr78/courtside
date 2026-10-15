package org.courtside.rules.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.config.ClubTimeZone;
import org.courtside.rules.BookingCounter;
import org.courtside.rules.RuleContext;
import org.courtside.rules.RuleViolation;
import org.courtside.rules.WeeklyHoursLimit;
import org.springframework.stereotype.Component;

import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.TemporalAdjusters;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;

@Component
@RequiredArgsConstructor
public class WeeklyBookedHoursRule implements BookingRule {

    private final WeeklyHoursLimit limit;
    private final BookingCounter bookingCounter;
    private final ClubTimeZone timeZone;

    @Override
    public List<RuleViolation> check(RuleContext context) {
        Optional<Integer> maxHours = limit.maxHoursFor(context.membershipTypeId());
        if (maxHours.isEmpty() || !bookingCounter.countsAgainstLimits(context.cardId())) {
            return List.of();
        }
        Week week = weekOf(context.slot().start());
        return check(context, maxHours.get(), () -> bookedIn(context, week));
    }

    // A move can lengthen a booking or carry it into a fuller week; the moved bookings leave their old place.
    @Override
    public boolean appliesToAMove() {
        return true;
    }

    // Occurrences of one series are judged together, so each one that passes counts for the next.
    @Override
    public Prepared prepare() {
        Map<UUID, Optional<Integer>> maxHoursByMembership = new HashMap<>();
        Map<UUID, Boolean> countingCards = new HashMap<>();
        Map<WeekOfAccount, Duration> booked = new HashMap<>();
        return context -> {
            Optional<Integer> maxHours = maxHoursByMembership.computeIfAbsent(
                    context.membershipTypeId(), limit::maxHoursFor);
            if (maxHours.isEmpty()
                    || !countingCards.computeIfAbsent(context.cardId(), bookingCounter::countsAgainstLimits)) {
                return List.of();
            }
            WeekOfAccount key = new WeekOfAccount(context.userAccountId(), weekOf(context.slot().start()));
            List<RuleViolation> violations = check(context, maxHours.get(),
                    () -> booked.computeIfAbsent(key, k -> bookedIn(context, k.week())));
            if (violations.isEmpty()) {
                booked.merge(key, context.slot().duration(), Duration::plus);
            }
            return violations;
        };
    }

    private List<RuleViolation> check(RuleContext context, int maxHours, Supplier<Duration> bookedThisWeek) {
        Duration booked = bookedThisWeek.get();
        if (booked.plus(context.slot().duration()).compareTo(Duration.ofHours(maxHours)) <= 0) {
            return List.of();
        }
        return List.of(new RuleViolation("booking.rule.weeklyBookedHours.exceeded",
                Map.of("maxHours", maxHours, "bookedMinutes", booked.toMinutes())));
    }

    private Duration bookedIn(RuleContext context, Week week) {
        return context.userAccountId() == null
                ? Duration.ZERO
                : bookingCounter.bookedTimeStartingBetween(
                        context.userAccountId(), week.from(), week.until(), context.movedBookingIds());
    }

    private Week weekOf(Instant instant) {
        ZoneId zone = timeZone.zoneId();
        LocalDate monday = instant.atZone(zone).toLocalDate()
                .with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        return new Week(monday.atStartOfDay(zone).toInstant(), monday.plusWeeks(1).atStartOfDay(zone).toInstant());
    }

    private record Week(Instant from, Instant until) {
    }

    private record WeekOfAccount(UUID accountId, Week week) {
    }
}
